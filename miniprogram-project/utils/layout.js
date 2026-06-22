const getSafeLayout = () => {
  const system = wx.getSystemInfoSync();
  const menu = wx.getMenuButtonBoundingClientRect();
  const statusTop = system.statusBarHeight || 20;
  const menuTop = menu && menu.top ? menu.top : statusTop + 8;
  const menuBottom = menu && menu.bottom ? menu.bottom : menuTop + 32;
  const menuHeight = Math.max(32, menuBottom - menuTop);
  const rpxToPx = system.windowWidth / 750;
  const backHeight = 40 * rpxToPx;
  const backVisualOffset = 5 * rpxToPx;
  const menuLeft = menu && menu.left ? menu.left : system.windowWidth - 96;
  const rightSafe = Math.max(16, system.windowWidth - menuLeft + 12);
  const closeRight = 32;
  const bottomSafe = Math.max(
    23,
    system.screenHeight - (system.safeArea ? system.safeArea.bottom : system.screenHeight) + 23
  );

  return {
    pageTop: menuBottom + 24,
    backTop: Math.round(menuTop + (menuHeight - backHeight) / 2 + backVisualOffset),
    titleTop: menuBottom + 48,
    actionTop: menuBottom + 46,
    actionRight: rightSafe,
    closeTop: menuBottom + 10,
    closeRight,
    panelTop: menuBottom + 96,
    bottomSafe
  };
};

module.exports = {
  getSafeLayout
};
