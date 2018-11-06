import axios from 'axios';
import { AxiosResponse } from 'axios';

interface LoginResponse {
    access_token: string;
    refresh_token: string;
}

interface DeviceResponse {
    device: {
        dsn: string;
        product_name: string;
        model: string;
        connection_status: string;
        device_type: string;
    }
}

interface PropertyResponse {
    property: {
        key: number;
        name: string;
        value: number | string;
    }
}

export const connect = async (email: string, password: string) => {
    const userHttp = axios.create({ baseURL: 'https://user-field.aylanetworks.com' });
    const adsHttp = axios.create({ baseURL: 'https://ads-field.aylanetworks.com/apiv1' });
    const loginResponse = await userHttp.post<LoginResponse>('users/sign_in.json', {
        user: {
            email,
            password,
            application: {
                app_id: 'OWL-id',
                app_secret: 'OWL-4163742'
            }
        }
    });

    let accessToken = loginResponse.data.access_token;
    let refreshToken = loginResponse.data.refresh_token;

    const appActiveIdMap: { [deviceId: string]: number } = {};
    const baseStationOnIdMap: { [deviceId: string]: number } = {};

    const runWithAuth = async <T> (fn: (auth: string) => Promise<AxiosResponse<T>>, retry = true): Promise<AxiosResponse<T>> => {
        return fn(`auth_token ${accessToken}`).catch(async (err) => {
            if (retry && err.response && err.response.status === 401) {
                const refreshResponse = await userHttp.post<LoginResponse>('users/refresh_token.json', {
                    user: {
                        refresh_token: refreshToken
                    }
                });
                accessToken = refreshResponse.data.access_token;
                refreshToken = refreshResponse.data.refresh_token;
                return runWithAuth(fn, false);
            } else {
                throw err;
            }
        });
    };

    const getPropertiesResponse = async (deviceId: string): Promise<AxiosResponse<PropertyResponse[]>> => {
        return runWithAuth((auth) => {
            return adsHttp.get<PropertyResponse[]>(`dsns/${deviceId}/properties.json`, {
                headers: {
                    Authorization: auth
                }
            });
        });
    };

    const getPropertyId = async (deviceId: string, propertyId: string): Promise<number> => {
        const response = await getPropertiesResponse(deviceId);
        for (const { property } of response.data) {
            if (property.name === propertyId) {
                return property.key;
            }
        }
    }

    const getBaseStationOnId = async (deviceId: string): Promise<number> => {
        if (!baseStationOnIdMap[deviceId]) {
            baseStationOnIdMap[deviceId] = await getPropertyId(deviceId, "BASE_STATION_ON");
        } 

        return baseStationOnIdMap[deviceId];
    }

    const getAppActiveId = async (deviceId: string): Promise<number> => {
        if (!appActiveIdMap[deviceId]) {
            appActiveIdMap[deviceId] = await getPropertyId(deviceId, "APP_ACTIVE");
        }

        return appActiveIdMap[deviceId];
    };

    const setProperty = async (propertyId: number, value: any): Promise<void> => {
        await runWithAuth((auth) => {
            return adsHttp.post(`properties/${propertyId}/datapoints.json`, {
                datapoint: {
                    value: value
                }
            }, {
                headers: {
                    Authorization: auth
                }
            });
        });
    };

    const sendAppActive = async (deviceId: string): Promise<void> => {
        const appActiveId = await getAppActiveId(deviceId);
        await setProperty(appActiveId, 1);
    };

    return {
        async getDevices() {
            const response = await runWithAuth((auth) => {
                return adsHttp.get<DeviceResponse[]>('devices.json', {
                    headers: {
                        Authorization: auth
                    }
                });
            });

            return response.data.map(({ device }) => ({
                id: device.dsn,
                type: device.device_type,
                product: device.product_name,
                model: device.model,
                connectionStatus: device.connection_status
            }));
        },

        async getProperties(deviceId: string) {
            await sendAppActive(deviceId);

            const response = await getPropertiesResponse(deviceId);

            const responseAsMap: {[prop: string]: number | string} = {};

            for (const { property } of response.data) {
                responseAsMap[property.name] = property.value;
            }

            const asBoolean = (value: number | string) => value === 1;

            return {
                babyName: <string> responseAsMap['BABY_NAME'],
                isBaseStationOn: asBoolean(responseAsMap['BASE_STATION_ON']),
                batteryLevel: <number> responseAsMap['BATT_LEVEL'],
                isCharging: asBoolean(responseAsMap['CHARGE_STATUS']),
                isSockOff: asBoolean(responseAsMap['SOCK_OFF']),
                isSockConnected: asBoolean(responseAsMap['SOCK_CONNECTION']),
                isWiggling: asBoolean(responseAsMap['MOVEMENT']),
                heartRate: <number> responseAsMap['HEART_RATE'],
                oxygenLevel: <number> responseAsMap['OXYGEN_LEVEL']
            };
        },

        async turnBaseStationOn(deviceId: string) {
            const baseStationOnId = await getBaseStationOnId(deviceId);
            await setProperty(baseStationOnId, 1);
        },

        async turnBaseStationOff(deviceId: string) {
            const baseStationOnId = await getBaseStationOnId(deviceId);
            await setProperty(baseStationOnId, 0);
        }
    };
};
