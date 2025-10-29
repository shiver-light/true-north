// pages/index/index.js

Page({
  data: {
    A: null,
    B: null,
    center: { latitude: 39.9042, longitude: 116.4074 },
    markers: [],
    polyline: [],
    // 展示用字符串
    bearingStr: "-",
    distanceStr: "-",
    altAStr: "-",
    altBStr: "-",
    altDiffStr: "-",
    // 地图拾取目标：'none' | 'A' | 'B'
    pickTarget: 'none'
  },

  onLoad() {
    const A = wx.getStorageSync('pointA') || null;
    const B = wx.getStorageSync('pointB') || null;

    this.setData({
      A, B,
      altAStr: A ? this.formatAltitude(A.altitude) : "-",
      altBStr: B ? this.formatAltitude(B.altitude) : "-",
      altDiffStr: (A && B && this.bothAltValid(A.altitude, B.altitude))
        ? this.formatAltitude(B.altitude - A.altitude)
        : "-"
    });

    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      enableHighAccuracy: true,
      highAccuracyExpireTime: 8000,
      success: (loc) => this.setData({ center: { latitude: loc.latitude, longitude: loc.longitude } }),
      fail: () => {
        if (A) this.setData({ center: A });
        else if (B) this.setData({ center: B });
      },
      complete: () => this.refreshMap()
    });
  },

  /* ========== 地图拾取 ========== */
  startPickA() { this.setData({ pickTarget: 'A' }); wx.showToast({ title: '点击地图设置 A', icon: 'none' }); },
  startPickB() { this.setData({ pickTarget: 'B' }); wx.showToast({ title: '点击地图设置 B', icon: 'none' }); },
  stopPick()   { this.setData({ pickTarget: 'none' }); wx.showToast({ title: '已取消拾取', icon: 'none' }); },

  onMapTap(e) {
    const { pickTarget } = this.data;
    if (!pickTarget || pickTarget === 'none') return;

    // e.detail 包含点击位置的经纬度
    const { latitude, longitude } = e.detail || {};
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      wx.showToast({ title: '未获取到点击坐标', icon: 'none' });
      return;
    }

    const point = { latitude, longitude, altitude: null }; // 地图拾取没有海拔
    if (pickTarget === 'A') {
      this.setData({ A: point, center: point, altAStr: this.formatAltitude(null) }, () => {
        this.refreshMap();
        this.updateAltDiff();
      });
      wx.setStorageSync('pointA', point);
      wx.showToast({ title: '已设置 A（无海拔）', icon: 'none' });
    } else if (pickTarget === 'B') {
      this.setData({ B: point, center: point, altBStr: this.formatAltitude(null) }, () => {
        this.refreshMap();
        this.updateAltDiff();
      });
      wx.setStorageSync('pointB', point);
      wx.showToast({ title: '已设置 B（无海拔）', icon: 'none' });
    }

    // 清空上次计算结果，退出拾取模式
    this.clearResults();
    this.setData({ pickTarget: 'none' });
  },

  /* ========== 按钮：当前定位采集 ========== */
  setAFromCurrent() {
    this.getCurrentLocation()
      .then((p) => {
        this.setData({ A: p, center: p, altAStr: this.formatAltitude(p.altitude) }, () => {
          this.refreshMap(); this.updateAltDiff();
        });
        wx.setStorageSync('pointA', p);
        this.clearResults();
        this.setData({ pickTarget: 'none' });
      })
      .catch(this.toastErr);
  },

  setBFromCurrent() {
    this.getCurrentLocation()
      .then((p) => {
        this.setData({ B: p, center: p, altBStr: this.formatAltitude(p.altitude) }, () => {
          this.refreshMap(); this.updateAltDiff();
        });
        wx.setStorageSync('pointB', p);
        this.clearResults();
        this.setData({ pickTarget: 'none' });
      })
      .catch(this.toastErr);
  },

  gotoA() { const { A } = this.data; if (A) this.setData({ center: A }); },
  gotoB() { const { B } = this.data; if (B) this.setData({ center: B }); },

  clearAll() {
    wx.removeStorageSync('pointA');
    wx.removeStorageSync('pointB');
    this.setData({
      A: null, B: null,
      markers: [], polyline: [],
      bearingStr: "-", distanceStr: "-",
      altAStr: "-", altBStr: "-", altDiffStr: "-",
      pickTarget: 'none'
    });
    wx.showToast({ title: '已清空', icon: 'none' });
  },

  /* ========== 计算方位角 + 距离 ========== */
  computeBearingAndDistance() {
    const { A, B } = this.data;
    if (!A || !B) {
      wx.showToast({ title: '请先设置 A 和 B', icon: 'none' });
      return;
    }
    const a = { latitude: Number(A.latitude), longitude: Number(A.longitude) };
    const b = { latitude: Number(B.latitude), longitude: Number(B.longitude) };

    const bearingDeg = this.initialBearing(a, b);       // 0–360°
    const distMeters = this.haversineDistance(a, b);    // 米

    if (!isFinite(bearingDeg)) {
      this.setData({ bearingStr: "-", distanceStr: this.formatDistance(distMeters) });
      wx.showToast({ title: '计算失败：方位角异常', icon: 'none' });
      return;
    }

    const bearingStr = this.formatBearing(bearingDeg);
    const distanceStr = this.formatDistance(distMeters);

    this.setData({ bearingStr, distanceStr });
    this.updateAltDiff();

    wx.showToast({ title: `偏移：${bearingDeg.toFixed(2)}°`, icon: 'none' });
  },

  clearResults() {
    // 采完点后先清空上次的计算结果（海拔即时显示已更新）
    this.setData({ bearingStr: "-", distanceStr: "-" });
  },

  /* ========== 定位（双请求拿海拔） ========== */
  getCurrentLocation() {
    const getGCJ02 = () => new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        isHighAccuracy: true,
        enableHighAccuracy: true,
        highAccuracyExpireTime: 8000,
        success: (res) => resolve({
          latitude: res.latitude,
          longitude: res.longitude
        }),
        fail: reject
      });
    });

    const getWGS84Alt = () => new Promise((resolve) => {
      wx.getLocation({
        type: 'wgs84',
        altitude: true,
        isHighAccuracy: true,
        enableHighAccuracy: true,
        highAccuracyExpireTime: 8000,
        success: (res) => resolve({
          altitude: (typeof res.altitude === 'number') ? res.altitude : null
        }),
        fail: () => resolve({ altitude: null })
      });
    });

    return Promise.all([getGCJ02(), getWGS84Alt()]).then(([gcj, wgsAlt]) => {
      return { ...gcj, altitude: wgsAlt.altitude }; // 经纬度用 gcj02，海拔用 wgs84
    });
  },

  /* ========== 地理计算 ========== */
  // 初始方位角：从真北顺时针 0–360°
  initialBearing(A, B) {
    const toRad = (d) => d * Math.PI / 180;
    const toDeg = (r) => r * 180 / Math.PI;

    const phi1 = toRad(A.latitude);
    const phi2 = toRad(B.latitude);
    const dLambda = toRad(B.longitude - A.longitude);

    if ([phi1, phi2, dLambda].some((v) => Number.isNaN(v))) return NaN;

    const y = Math.sin(dLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
    const theta = Math.atan2(y, x);                 // -π ~ +π
    const deg = (toDeg(theta) + 360) % 360;         // 0 ~ 360
    return deg;
  },

  // Haversine 大圆距离（米）
  haversineDistance(A, B) {
    const R = 6371000; // 地球半径（米）
    const toRad = (d) => d * Math.PI / 180;
    const phi1 = toRad(A.latitude);
    const phi2 = toRad(B.latitude);
    const dPhi = phi2 - phi1;
    const dLambda = toRad(B.longitude - A.longitude);

    const sinDphi = Math.sin(dPhi / 2);
    const sinDlam = Math.sin(dLambda / 2);
    const a = sinDphi * sinDphi + Math.cos(phi1) * Math.cos(phi2) * sinDlam * sinDlam;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // 米
  },

  /* ========== 展示格式化 ========== */
  formatBearing(deg) {
    if (typeof deg !== 'number' || !isFinite(deg)) return '-';
    return deg.toFixed(3) + '°';
  },
  formatDistance(meters) {
    if (typeof meters !== 'number' || !isFinite(meters)) return '-';
    if (meters < 1000) return meters.toFixed(1) + ' m';
    return (meters / 1000).toFixed(3) + ' km';
  },
  formatAltitude(m) {
    if (m === undefined || m === null || !isFinite(m)) return '-';
    return Number(m).toFixed(1) + ' m';
  },

  bothAltValid(a, b) {
    return (a !== undefined && a !== null && isFinite(a)) &&
           (b !== undefined && b !== null && isFinite(b));
  },

  updateAltDiff() {
    const { A, B } = this.data;
    if (A && B && this.bothAltValid(A.altitude, B.altitude)) {
      this.setData({ altDiffStr: this.formatAltitude(B.altitude - A.altitude) });
    } else {
      this.setData({ altDiffStr: "-" });
    }
  },

  /* ========== 地图渲染 ========== */
  refreshMap() {
    const { A, B } = this.data;
    const markers = [];
    const polyline = [];

    if (A) {
      markers.push({
        id: 1, latitude: Number(A.latitude), longitude: Number(A.longitude),
        width: 24, height: 24, callout: { content: 'A', display: 'ALWAYS' }
      });
    }
    if (B) {
      markers.push({
        id: 2, latitude: Number(B.latitude), longitude: Number(B.longitude),
        width: 24, height: 24, callout: { content: 'B', display: 'ALWAYS' }
      });
    }
    if (A && B) {
      polyline.push({
        points: [
          { latitude: Number(A.latitude), longitude: Number(A.longitude) },
          { latitude: Number(B.latitude), longitude: Number(B.longitude) }
        ],
        width: 4,
        color: '#0081ff'
      });
    }
    this.setData({ markers, polyline });
  },

  /* ========== 通用提示 ========== */
  toastErr(err) {
    wx.showToast({ title: (err && err.errMsg) ? err.errMsg : '获取定位失败', icon: 'none' });
  }
});