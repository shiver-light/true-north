// pages/index/index.js

const I18N = {
  zh: {
    title: '真北工具',
    langHint: '切换语言 / Switch language',
    satellite: '卫星图',
    pickToA: '拾取到A',
    pickToB: '拾取到B',
    cancelPick: '取消拾取',
    pickHintIdle: '（点击“拾取到A/B”后，再点地图选择位置）',
    pickHintActive: '拾取模式：点击地图写入 {target}',
    currentToA: '当前→A',
    currentToB: '当前→B',
    gotoA: '定位到A',
    gotoB: '定位到B',
    clearAB: '清空A/B',
    compute: '计算',
    unset: '未设置',
    altA: 'A海拔：',
    altB: 'B海拔：',
    bearingLabel: 'AB直线方位角（自真北顺时针）：',
    distanceLabel: 'AB直线距离：',
    altDiffLabel: '高度差 ΔH（B - A）：',
    toastSetA: '已设置 A（无海拔）',
    toastSetB: '已设置 B（无海拔）',
    toastCancelPick: '已取消拾取',
    toastClickMapSetA: '点击地图设置 A',
    toastClickMapSetB: '点击地图设置 B',
    toastNoCoord: '未获取到点击坐标',
    toastNeedAB: '请先设置 A 和 B',
    toastBearingErr: '计算失败：方位角异常',
    toastCleared: '已清空',
    toastOffset: (deg) => `偏移：${deg.toFixed(2)}°`,
    unitM: ' m', unitKm: ' km'
  },
  en: {
    title: 'True North Tool',
    langHint: 'Switch language / 切换语言',
    satellite: 'Satellite',
    pickToA: 'Pick to A',
    pickToB: 'Pick to B',
    cancelPick: 'Cancel',
    pickHintIdle: '(Tap “Pick to A/B”, then tap the map)',
    pickHintActive: 'Picking: tap map to set {target}',
    currentToA: 'Here → A',
    currentToB: 'Here → B',
    gotoA: 'Go to A',
    gotoB: 'Go to B',
    clearAB: 'Clear A/B',
    compute: 'Compute',
    unset: 'Not set',
    altA: 'Altitude of A:',
    altB: 'Altitude of B:',
    bearingLabel: 'AB Bearing (clockwise from True North):',
    distanceLabel: 'AB Great-circle Distance:',
    altDiffLabel: 'Altitude ΔH (B - A):',
    toastSetA: 'A set (no altitude)',
    toastSetB: 'B set (no altitude)',
    toastCancelPick: 'Picking canceled',
    toastClickMapSetA: 'Tap map to set A',
    toastClickMapSetB: 'Tap map to set B',
    toastNoCoord: 'Failed to read tapped coordinate',
    toastNeedAB: 'Please set both A and B first',
    toastBearingErr: 'Failed: bearing error',
    toastCleared: 'Cleared',
    toastOffset: (deg) => `Offset: ${deg.toFixed(2)}°`,
    unitM: ' m', unitKm: ' km'
  }
};

Page({
  data: {
    // 业务
    A: null, B: null,
    center: { latitude: 39.9042, longitude: 116.4074 },
    markers: [], polyline: [],
    bearingStr: "-", distanceStr: "-",
    altAStr: "-", altBStr: "-", altDiffStr: "-",
    pickTarget: 'none',
    // 图层
    satellite: false,
    // 语言
    lang: 'zh', t: I18N.zh
  },

  onLoad() {
    // 语言初始化
    const savedLang = wx.getStorageSync('lang');
    let lang = savedLang || 'zh';
    try {
      if (!savedLang) {
        const sys = wx.getSystemInfoSync();
        const prefix = (sys.language || '').toLowerCase();
        if (prefix.startsWith('en')) lang = 'en';
        if (prefix.startsWith('zh')) lang = 'zh';
      }
    } catch(_) {}
    this.applyLang(lang, false);

    // 卫星图状态
    const savedSat = wx.getStorageSync('satellite');
    if (typeof savedSat === 'boolean') this.setData({ satellite: savedSat });

    // 恢复 A/B
    const A = wx.getStorageSync('pointA') || null;
    const B = wx.getStorageSync('pointB') || null;
    this.setData({
      A, B,
      altAStr: A ? this.formatAltitude(A.altitude) : "-",
      altBStr: B ? this.formatAltitude(B.altitude) : "-",
      altDiffStr: (A && B && this.bothAltValid(A.altitude, B.altitude))
        ? this.formatAltitude(B.altitude - A.altitude) : "-"
    });

    // 定位居中
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true, enableHighAccuracy: true,
      highAccuracyExpireTime: 8000,
      success: (loc) => this.setData({ center: { latitude: loc.latitude, longitude: loc.longitude } }),
      complete: () => this.refreshMap()
    });
  },

  /* ===== 语言切换 ===== */
  switchToZh() { this.applyLang('zh', true); }
  ,
  switchToEn() { this.applyLang('en', true); },
  applyLang(lang, toast) {
    const t = I18N[lang] || I18N.zh;
    this.setData({ lang, t });
    wx.setStorageSync('lang', lang);
    wx.setNavigationBarTitle({ title: t.title });
    if (toast) wx.showToast({ title: lang === 'zh' ? '已切换到中文' : 'Switched to English', icon: 'none' });
  },

  /* ===== 卫星图开关 ===== */
  toggleSatellite(e) {
    const on = !!e.detail.value;
    this.setData({ satellite: on });
    wx.setStorageSync('satellite', on);
  },

  /* ===== 地图拾取 ===== */
  startPickA() { this.setData({ pickTarget: 'A' }); wx.showToast({ title: this.data.t.toastClickMapSetA, icon: 'none' }); },
  startPickB() { this.setData({ pickTarget: 'B' }); wx.showToast({ title: this.data.t.toastClickMapSetB, icon: 'none' }); },
  stopPick()   { if (this.data.pickTarget === 'none') return; this.setData({ pickTarget: 'none' }); wx.showToast({ title: this.data.t.toastCancelPick, icon: 'none' }); },

  onMapTap(e) {
    const { pickTarget, t } = this.data;
    if (!pickTarget || pickTarget === 'none') return;

    const { latitude, longitude } = e.detail || {};
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      wx.showToast({ title: t.toastNoCoord, icon: 'none' }); return;
    }

    const point = { latitude, longitude, altitude: null }; // 地图拾取无海拔
    if (pickTarget === 'A') {
      this.setData({ A: point, center: point, altAStr: this.formatAltitude(null) }, () => {
        this.refreshMap(); this.updateAltDiff();
      });
      wx.setStorageSync('pointA', point);
      wx.showToast({ title: t.toastSetA, icon: 'none' });
    } else if (pickTarget === 'B') {
      this.setData({ B: point, center: point, altBStr: this.formatAltitude(null) }, () => {
        this.refreshMap(); this.updateAltDiff();
      });
      wx.setStorageSync('pointB', point);
      wx.showToast({ title: t.toastSetB, icon: 'none' });
    }

    this.clearResults();
    this.setData({ pickTarget: 'none' });
  },

  /* ===== 按钮：当前定位采集 ===== */
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

  /* ===== 清空/计算（禁用态已在 WXML 控制，逻辑再兜底） ===== */
  clearAll() {
    if (!this.data.A && !this.data.B) return;
    const { t } = this.data;
    wx.removeStorageSync('pointA'); wx.removeStorageSync('pointB');
    this.setData({
      A: null, B: null, markers: [], polyline: [],
      bearingStr: "-", distanceStr: "-",
      altAStr: "-", altBStr: "-", altDiffStr: "-",
      pickTarget: 'none'
    });
    wx.showToast({ title: t.toastCleared, icon: 'none' });
  },

  computeBearingAndDistance() {
    const { A, B, t } = this.data;
    if (!A || !B) { wx.showToast({ title: t.toastNeedAB, icon: 'none' }); return; }

    const a = { latitude: Number(A.latitude), longitude: Number(A.longitude) };
    const b = { latitude: Number(B.latitude), longitude: Number(B.longitude) };

    const bearingDeg = this.initialBearing(a, b);
    const distMeters = this.haversineDistance(a, b);

    if (!isFinite(bearingDeg)) {
      this.setData({ bearingStr: "-", distanceStr: this.formatDistance(distMeters) });
      wx.showToast({ title: t.toastBearingErr, icon: 'none' });
      return;
    }

    this.setData({
      bearingStr: this.formatBearing(bearingDeg),
      distanceStr: this.formatDistance(distMeters)
    });
    this.updateAltDiff();
    wx.showToast({ title: t.toastOffset(bearingDeg), icon: 'none' });
  },

  clearResults() { this.setData({ bearingStr: "-", distanceStr: "-" }); },

  /* ===== 定位（双请求拿海拔） ===== */
  getCurrentLocation() {
    const getGCJ02 = () => new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02', isHighAccuracy: true, enableHighAccuracy: true, highAccuracyExpireTime: 8000,
        success: (res) => resolve({ latitude: res.latitude, longitude: res.longitude }),
        fail: reject
      });
    });
    const getWGS84Alt = () => new Promise((resolve) => {
      wx.getLocation({
        type: 'wgs84', altitude: true, isHighAccuracy: true, enableHighAccuracy: true, highAccuracyExpireTime: 8000,
        success: (res) => resolve({ altitude: (typeof res.altitude === 'number') ? res.altitude : null }),
        fail: () => resolve({ altitude: null })
      });
    });
    return Promise.all([getGCJ02(), getWGS84Alt()]).then(([gcj, wgsAlt]) => ({ ...gcj, altitude: wgsAlt.altitude }));
  },

  /* ===== 地理计算 ===== */
  initialBearing(A, B) {
    const toRad = (d) => d * Math.PI / 180, toDeg = (r) => r * 180 / Math.PI;
    const phi1 = toRad(A.latitude), phi2 = toRad(B.latitude), dLambda = toRad(B.longitude - A.longitude);
    if ([phi1, phi2, dLambda].some((v) => Number.isNaN(v))) return NaN;
    const y = Math.sin(dLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  },
  haversineDistance(A, B) {
    const R = 6371000, toRad = (d) => d * Math.PI / 180;
    const phi1 = toRad(A.latitude), phi2 = toRad(B.latitude);
    const dPhi = phi2 - phi1, dLambda = toRad(B.longitude - A.longitude);
    const sinDphi = Math.sin(dPhi / 2), sinDlam = Math.sin(dLambda / 2);
    const a = sinDphi*sinDphi + Math.cos(phi1)*Math.cos(phi2)*sinDlam*sinDlam;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  /* ===== 展示格式化/辅助 ===== */
  formatBearing(d) { return (typeof d !== 'number' || !isFinite(d)) ? '-' : d.toFixed(3) + '°'; },
  formatDistance(m) {
    const { t } = this.data;
    return (typeof m !== 'number' || !isFinite(m)) ? '-' : (m < 1000 ? m.toFixed(1) + t.unitM : (m/1000).toFixed(3) + t.unitKm);
  },
  formatAltitude(m) { const { t } = this.data; return (m === undefined || m === null || !isFinite(m)) ? '-' : Number(m).toFixed(1) + t.unitM; },
  bothAltValid(a, b) { return (a !== undefined && a !== null && isFinite(a)) && (b !== undefined && b !== null && isFinite(b)); },
  updateAltDiff() {
    const { A, B } = this.data;
    this.setData({ altDiffStr: (A && B && this.bothAltValid(A.altitude, B.altitude)) ? this.formatAltitude(B.altitude - A.altitude) : '-' });
  },

  /* ===== 地图渲染 ===== */
  refreshMap() {
    const { A, B } = this.data;
    const markers = [], polyline = [];
    if (A) markers.push({ id: 1, latitude: Number(A.latitude), longitude: Number(A.longitude), width: 24, height: 24, callout: { content: 'A', display: 'ALWAYS' } });
    if (B) markers.push({ id: 2, latitude: Number(B.latitude), longitude: Number(B.longitude), width: 24, height: 24, callout: { content: 'B', display: 'ALWAYS' } });
    if (A && B) polyline.push({ points: [
      { latitude: Number(A.latitude), longitude: Number(A.longitude) },
      { latitude: Number(B.latitude), longitude: Number(B.longitude) }
    ], width: 4, color: '#0081ff' });
    this.setData({ markers, polyline });
  },

  /* ===== 通用提示 ===== */
  toastErr(err) { wx.showToast({ title: (err && err.errMsg) ? err.errMsg : '定位失败', icon: 'none' }); }
});