export type CarouselPosition = {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
  containerLeft: number;
  itemLefts: number[];
};

export function getActiveCarouselIndex(position: CarouselPosition) {
  if (position.itemLefts.length === 0) return 0;
  const endOfScroll = position.scrollWidth - position.clientWidth;
  if (position.scrollLeft >= endOfScroll - 1) return position.itemLefts.length - 1;
  return position.itemLefts.reduce((closest, itemLeft, index) => (
    Math.abs(itemLeft - position.containerLeft)
      < Math.abs(position.itemLefts[closest] - position.containerLeft)
      ? index
      : closest
  ), 0);
}