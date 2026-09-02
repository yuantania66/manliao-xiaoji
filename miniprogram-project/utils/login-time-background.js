const LOGIN_BACKGROUNDS = Object.freeze({
  dawn: "/assets/login-times/login-dawn.jpg",
  day: "/assets/login-times/login-day.jpg",
  dusk: "/assets/login-times/login-dusk.jpg",
  night: "/assets/login-times/login-night.jpg"
});
const LOGIN_BACKGROUND_TOP_COLORS = Object.freeze({
  dawn: "#dbd0bc",
  day: "#ddd5c3",
  dusk: "#dfb38e",
  night: "#c5bca8"
});

function getLoginTimeSlot(hour = new Date().getHours()) {
  const normalizedHour = ((Number(hour) % 24) + 24) % 24;
  if (normalizedHour >= 5 && normalizedHour < 9) return "dawn";
  if (normalizedHour >= 9 && normalizedHour < 17) return "day";
  if (normalizedHour >= 17 && normalizedHour < 20) return "dusk";
  return "night";
}

function getLoginBackground(hour) {
  return LOGIN_BACKGROUNDS[getLoginTimeSlot(hour)];
}

function getLoginBackgroundTopColor(hour) {
  return LOGIN_BACKGROUND_TOP_COLORS[getLoginTimeSlot(hour)];
}

function getLoginBackgroundInsetTop(systemInfo, menuRect) {
  try {
    const system = systemInfo || wx.getSystemInfoSync();
    const menu = menuRect || wx.getMenuButtonBoundingClientRect();
    const windowWidth = Number(system?.windowWidth) || 375;
    const statusBarHeight = Number(system?.statusBarHeight) || 20;
    const menuBottom = Number(menu?.bottom) || statusBarHeight + 40;
    const artworkArchTop = windowWidth * 56 / 750;
    return Math.max(0, Math.ceil(menuBottom + 8 - artworkArchTop));
  } catch {
    return 0;
  }
}

module.exports = {
  getLoginBackground,
  getLoginBackgroundInsetTop,
  getLoginBackgroundTopColor,
  getLoginTimeSlot
};
