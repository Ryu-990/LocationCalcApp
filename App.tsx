import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import * as Crypto from 'expo-crypto';

// Expo環境では global.crypto が未定義なので登録
if (typeof global.crypto === 'undefined') {
  global.crypto = Crypto as any;
}

import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  StatusBar,
  Dimensions,
} from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import LocationService from './LocationService';
import { Geodesic } from 'geographiclib';

const { width, height } = Dimensions.get('window');
/**
 * @author Ryu Hazako
 * @createdAt 2025-10-05
 */
const App = () => {
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [totalDistance, setTotalDistance] = useState<number>(0);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [currentPosition, setCurrentPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<{ latitude: number; longitude: number }[]>([]);
  const [mapZoom, setMapZoom] = useState<number>(0.01);

  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mapRef = useRef<MapView>(null);
  const lastPositionRef = useRef<{ latitude: number; longitude: number } | null>(null); // ← useRefで管理

  /**  初期位置設定(東京駅)
   * */
  const initialRegion = {
    latitude: 35.6812,
    longitude: 139.7671,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  };

  /**  2点間の測地線距離を計算
   *  楕円体モデルを使用して、2点間の最短距離を計算します。
   *  Haversineよりも精度が高いです。
   * @param lat1 緯度1
   * @param lon1 経度1
   * @param lat2 緯度2
   * @param lon2 経度2
   * @returns 距離(m)
   * */
  const calculateDistanceGeodesic = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const geod = Geodesic.WGS84;
    const result = geod.Inverse(lat1, lon1, lat2, lon2);
    return result.s12 ?? 0;
  };

  /** 時間フォーマット */
  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  };

  /**  距離フォーマット*/
  const formatDistance = (meters: number) => {
    if (meters < 1000) return `${meters.toFixed(1)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  };

  /** 速度フォーマット*/
  const formatSpeed = (mps: number) => `${(mps * 3.6).toFixed(1)} km/h`;

  /**  権限リクエスト */
  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      return status === 'granted';
    } catch (err) {
      console.warn(err);
      return false;
    }
  };

  /** 地図を現在地へ */
  const centerMapOnUser = () => {
    if (currentPosition && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: currentPosition.latitude,
          longitude: currentPosition.longitude,
          latitudeDelta: mapZoom,
          longitudeDelta: mapZoom,
        },
        1000
      );
    }
  };

  /** ズーム操作 */
  const zoomIn = () => setMapZoom((z) => Math.max(0.0025, z * 0.5));
  const zoomOut = () => setMapZoom((z) => Math.min(0.05, z * 2));

  /** トラッキング開始 */
  const startTracking = async () => {
    const hasPermission = await requestLocationPermission();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Location permission is required to track your movement.');
      return;
    }

    setIsTracking(true);
    setTotalDistance(0);
    setDuration(0);
    setRouteCoordinates([]);
    lastPositionRef.current = null;
    startTimeRef.current = Date.now();

    /**  経過時間タイマー */
    durationIntervalRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - (startTimeRef.current ?? 0)) / 1000);
      setDuration(elapsed);
    }, 1000);

    try {
      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 1000,
          distanceInterval: 1,
        },
        (location) => {
          const { latitude, longitude, speed } = location.coords;
          const newPosition = { latitude, longitude };

          setCurrentPosition(newPosition);
          setCurrentSpeed(speed || 0);

          // 初回
          if (!lastPositionRef.current) {
            lastPositionRef.current = newPosition;
            setRouteCoordinates([newPosition]);
            return;
          }

          const distance = calculateDistanceGeodesic(
            lastPositionRef.current.latitude,
            lastPositionRef.current.longitude,
            latitude,
            longitude
          );

          if (distance > 3) {
            setTotalDistance((prev) => prev + distance);
            setRouteCoordinates((prev) => [...prev, newPosition]);
          }

          lastPositionRef.current = newPosition;

          // AWS へ送信
          LocationService.trackPosition(latitude, longitude);
        }
      );
    } catch (error) {
      console.error('Location error:', error);
      Alert.alert('Location Error', 'Failed to get location. Please check your GPS settings.');
    }
  };

  /**  トラッキング停止 */
  const stopTracking = () => {
    setIsTracking(false);
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  };

  /**  リセット */
  const resetTracking = () => {
    stopTracking();
    setTotalDistance(0);
    setCurrentSpeed(0);
    setDuration(0);
    setRouteCoordinates([]);
    lastPositionRef.current = null;
  };

  // 初期位置取得
  useEffect(() => {
    (async () => {
      const hasPermission = await requestLocationPermission();
      if (hasPermission) {
        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          const { latitude, longitude } = loc.coords;
          setCurrentPosition({ latitude, longitude });
        } catch (err) {
          console.warn('Failed to get initial location:', err);
        }
      }
    })();
  }, []);

  // クリーンアップ
  useEffect(() => {
    return () => {
      locationSubscription.current?.remove();
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    };
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a237e" />
      <View style={styles.header}>
        <Text style={styles.title}>GPS 距離トラッカー (AWS Location)</Text>
      </View>

      {/* マップ */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          initialRegion={initialRegion}
          region={
            currentPosition
              ? {
                  latitude: currentPosition.latitude,
                  longitude: currentPosition.longitude,
                  latitudeDelta: 0.005,
                  longitudeDelta: 0.005,
                }
              : undefined
          }
          showsUserLocation
          showsMyLocationButton={false}
          followsUserLocation={isTracking}
          showsCompass
          showsScale
        >
          {currentPosition && (
            <Marker coordinate={currentPosition} title="現在位置" pinColor="#f44336" />
          )}
          {routeCoordinates.length > 1 && (
            <Polyline
              coordinates={routeCoordinates}
              strokeColor="#1a237e"
              strokeWidth={4}
              lineCap="round"
              lineJoin="round"
            />
          )}
        </MapView>

        <TouchableOpacity style={styles.centerButton} onPress={centerMapOnUser}>
          <Text style={styles.centerButtonText}>📍</Text>
        </TouchableOpacity>
      </View>

      {/* 統計表示 */}
      <View style={styles.statsContainer}>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>距離</Text>
            <Text style={styles.statValue}>{formatDistance(totalDistance)}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>速度</Text>
            <Text style={styles.statValue}>{formatSpeed(currentSpeed)}</Text>
          </View>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>時間</Text>
            <Text style={styles.statValue}>{formatTime(duration)}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>平均</Text>
            <Text style={styles.statValue}>
              {duration > 0 ? formatSpeed(totalDistance / duration) : '0.0 km/h'}
            </Text>
          </View>
        </View>
      </View>

      {/* ボタン */}
      <View style={styles.controlsContainer}>
        {!isTracking ? (
          <TouchableOpacity style={styles.startButton} onPress={startTracking}>
            <Text style={styles.buttonText}>開始</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.stopButton} onPress={stopTracking}>
            <Text style={styles.buttonText}>停止</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.resetButton} onPress={resetTracking}>
          <Text style={styles.buttonText}>リセット</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statusContainer}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: isTracking ? '#4caf50' : '#f44336' },
          ]}
        />
        <Text style={styles.statusText}>
          {isTracking ? 'トラッキング中 (AWS Location)' : 'トラッキング停止中'}
        </Text>
      </View>
    </View>
  );
};

// ====== スタイル ======
const { width: w, height: h } = Dimensions.get('window');
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#1a237e', paddingTop: 50, paddingBottom: 15, alignItems: 'center' },
  title: { fontSize: 18, fontWeight: 'bold', color: 'white' },
  mapContainer: { height: h * 0.4 },
  map: { flex: 1 },
  centerButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'white',
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
  },
  centerButtonText: { fontSize: 20 },
  statsContainer: { padding: 15 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  statCard: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 15,
    width: (w - 45) / 2,
    alignItems: 'center',
    elevation: 2,
  },
  statLabel: { fontSize: 14, color: '#666', marginBottom: 5 },
  statValue: { fontSize: 18, fontWeight: 'bold', color: '#1a237e' },
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  startButton: { backgroundColor: '#4caf50', paddingVertical: 12, paddingHorizontal: 30, borderRadius: 20 },
  stopButton: { backgroundColor: '#f44336', paddingVertical: 12, paddingHorizontal: 30, borderRadius: 20 },
  resetButton: { backgroundColor: '#ff9800', paddingVertical: 12, paddingHorizontal: 30, borderRadius: 20 },
  buttonText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  statusContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingBottom: 20 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  statusText: { fontSize: 14, color: '#666' },
});

export default App;
