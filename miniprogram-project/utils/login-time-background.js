const LOGIN_BACKGROUNDS = Object.freeze({
  dawn: "/assets/login-times/login-dawn.jpg",
  day: "/assets/login-times/login-day.jpg",
  dusk: "/assets/login-times/login-dusk.jpg",
  night: "/assets/login-times/login-night.jpg"
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

module.exports = { getLoginBackground, getLoginTimeSlot };
