import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import { 
  LocationClient, 
  BatchUpdateDevicePositionCommand,
  SearchPlaceIndexForTextCommand, 
  SearchPlaceIndexForPositionCommand, 
  CalculateRouteCommand, 
  GetDevicePositionHistoryCommand, 
  GetDevicePositionHistoryCommandOutput, 
  CalculateRouteCommandOutput 
} from '@aws-sdk/client-location';
import { CognitoIdentityClient } from '@aws-sdk/client-cognito-identity';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-provider-cognito-identity';
import awsConfig from './aws-config.json';

interface AWSConfig {
  region: string;
  identityPoolId: string;
  trackerName: string;
  mapName: string;
  placeIndexName: string;
  routeCalculatorName: string;
}
/**
 * @author Ryu Hazako
 * @createdAt 2025-10-05
 */
class LocationService {
  region: string;
  identityPoolId: string;
  trackerName: string;
  mapName: string;
  placeIndexName: string;
  routeCalculatorName: string;
  locationClient: LocationClient | null;
  deviceId: string;

  constructor() {
    // aws-config.jsonから設定を読み込み
    const config: AWSConfig = awsConfig;
    
    this.region = config.region;
    this.identityPoolId = config.identityPoolId;
    this.trackerName = config.trackerName;
    this.mapName = config.mapName;
    this.placeIndexName = config.placeIndexName;
    this.routeCalculatorName = config.routeCalculatorName;
    
    this.locationClient = null;
    this.deviceId = this.generateDeviceId();
    this.initialize();
  }

  /** デバイスIDの生成 */
  generateDeviceId() {
    return `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /** AWS Location Clientの初期化 */
  async initialize() {
    try {
      const credentials = fromCognitoIdentityPool({
        client: new CognitoIdentityClient({ region: this.region }),
        identityPoolId: this.identityPoolId,
      });

      this.locationClient = new LocationClient({
        region: this.region,
        credentials,
      });
      
      console.log('AWS Location Service initialized');
    } catch (error) {
      console.error('Failed to initialize AWS Location Service:', error);
    }
  }

  /** 位置情報をAWS Location Serviceに送信 */
  async trackPosition(latitude: number, longitude: number, accuracy: number | null = null, timestamp: Date = new Date()) {
    if (!this.locationClient) {
      console.warn('Location client not initialized');
      return;
    }

    try {
      const command = new BatchUpdateDevicePositionCommand({
        TrackerName: this.trackerName,
        Updates: [
          {
            DeviceId: this.deviceId,
            Position: [longitude, latitude], // AWS Location Serviceは [lng, lat] 形式
            SampleTime: timestamp,
            Accuracy: accuracy ? { Horizontal: accuracy } : undefined,
          },
        ],
      });

      const response = await this.locationClient.send(command);
      console.log('Position tracked successfully:', response);
      return response;
    } catch (error) {
      console.error('Failed to track position:', error);
      throw error;
    }
  }

  /** 地図タイルのURLを取得(Mapbox形式) */
  getMapTileUrl() {
    return `https://maps.geo.${this.region}.amazonaws.com/maps/v0/maps/${this.mapName}/tiles/{z}/{x}/{y}`;
  }

  /**  スタイルURLを取得 */
  getMapStyleUrl() {
    // Amazon Location ServiceでサポートされているMapboxスタイル
    return {
      streets: 'mapbox://styles/mapbox/streets-v12',
      satellite: 'mapbox://styles/mapbox/satellite-v9',
      light: 'mapbox://styles/mapbox/light-v10',
      dark: 'mapbox://styles/mapbox/dark-v10',
    };
  }

  /** ジオコーディング(住所から座標を取得) */
  async geocode(address: any) {
    if (!this.locationClient) {
      throw new Error('Location client not initialized');
    }

    try {
      const command = new SearchPlaceIndexForTextCommand({
        IndexName: this.placeIndexName,
        Text: address,
        MaxResults: 1,
      });

      const response = await this.locationClient.send(command);
      if (response.Results && response.Results.length > 0) {
        const place = response.Results[0].Place;
        return {
          latitude: place?.Geometry?.Point?.[1],
          longitude: place?.Geometry?.Point?.[0],
          address: place?.Label,
        };
      }
      return null;
    } catch (error) {
      console.error('Geocoding failed:', error);
      throw error;
    }
  }

  /** 逆ジオコーディング(座標から住所を取得) */
  async reverseGeocode(latitude: number, longitude: number) {
    if (!this.locationClient) {
      throw new Error('Location client not initialized');
    }

    try {
      const command = new SearchPlaceIndexForPositionCommand({
        IndexName: this.placeIndexName,
        Position: [longitude, latitude],
        MaxResults: 1,
      });

      const response = await this.locationClient.send(command);
      if (response.Results && response.Results.length > 0) {
        const place = response.Results[0].Place;
        return {
          address: place?.Label,
          country: place?.Country,
          region: place?.Region,
          municipality: place?.Municipality,
        };
      }
      return null;
    } catch (error) {
      console.error('Reverse geocoding failed:', error);
      throw error;
    }
  }

  /**  ルート計算 */
  async calculateRoute(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
    travelMode: 'Car' | 'Truck' | 'Walking' = 'Car'
  ) {
    if (!this.locationClient) {
      throw new Error('Location client not initialized');
    }

    try {
      const command = new CalculateRouteCommand({
        CalculatorName: this.routeCalculatorName,
        DeparturePosition: [startLng, startLat],
        DestinationPosition: [endLng, endLat],
        TravelMode: travelMode, // 'Car', 'Truck', 'Walking'
        IncludeLegGeometry: true,
        DistanceUnit: 'Kilometers',
      });

      const response: CalculateRouteCommandOutput = await this.locationClient.send(command);
      return {
        distance: response.Summary?.Distance,
        duration: response.Summary?.DurationSeconds,
        geometry: response.Legs?.[0].Geometry?.LineString,
      };
    } catch (error) {
      console.error('Route calculation failed:', error);
      throw error;
    }
  }

  /** デバイスの位置履歴を取得 */
  async getDevicePositionHistory(startTime: any, endTime: any) {
    if (!this.locationClient) {
      throw new Error('Location client not initialized');
    }

    try {
      const command = new GetDevicePositionHistoryCommand({
        TrackerName: this.trackerName,
        DeviceId: this.deviceId,
        StartTimeInclusive: startTime,
        EndTimeExclusive: endTime,
      });

      const response: GetDevicePositionHistoryCommandOutput = await this.locationClient.send(command);
      return response.DevicePositions?.map(pos => ({
        latitude: pos.Position?.[1],
        longitude: pos.Position?.[0],
        timestamp: pos.SampleTime,
        accuracy: pos.Accuracy?.Horizontal,
      }));
    } catch (error) {
      console.error('Failed to get position history:', error);
      throw error;
    }
  }
}

export default new LocationService();