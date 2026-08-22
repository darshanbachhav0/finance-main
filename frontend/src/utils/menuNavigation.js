export function getMenuNavigationIndex(items, currentIndex, key) {
  const enabled = items
    .map((item, index) => (item.disabled ? -1 : index))
    .filter((index) => index >= 0);

  if (!enabled.length) return -1;
  if (key === "Home") return enabled[0];
  if (key === "End") return enabled[enabled.length - 1];

  const currentPosition = enabled.indexOf(currentIndex);
  if (key === "ArrowUp") {
    if (currentPosition <= 0) return enabled[enabled.length - 1];
    return enabled[currentPosition - 1];
  }
  if (key === "ArrowDown") {
    if (currentPosition < 0 || currentPosition === enabled.length - 1) return enabled[0];
    return enabled[currentPosition + 1];
  }
  return currentIndex;
}
