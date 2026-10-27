import assert from 'node:assert/strict';

type Browser = {
  evaluate(expression: string): Promise<any>;
  wait(expression: string): Promise<void>;
  send(method: string, params?: Record<string, unknown>): Promise<any>;
};
const byId = (id: string) => `[data-testid="${id}"]`;

async function rect(browser: Browser, selector: string) {
  const box = await browser.evaluate(`(() => {
    const el=document.querySelector(${JSON.stringify(selector)});
    if(!el) throw new Error('Missing geometry target: '+${JSON.stringify(selector)});
    const r=el.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,viewport:document.documentElement.clientWidth};
  })()`);
  assert.ok(box.width > 0 && box.height > 0, `${selector} must be visible: ${JSON.stringify(box)}`);
  return box;
}

async function bounded(browser: Browser, selector: string, max: number, centered = true) {
  const box = await rect(browser, selector);
  assert.ok(box.width <= max + 1, `${selector} exceeds ${max}px: ${JSON.stringify(box)}`);
  assert.ok(box.x >= -1 && box.right <= box.viewport + 1, `${selector} escapes viewport: ${JSON.stringify(box)}`);
  if (centered) assert.ok(Math.abs(box.x - (box.viewport - box.right)) <= 2, `${selector} is not centered: ${JSON.stringify(box)}`);
}

async function proportion(browser: Browser, selector: string, ratio: number) {
  const box = await rect(browser, selector);
  assert.ok(Math.abs(box.width / box.height - ratio) < 0.012, `${selector} expected ${ratio} ratio: ${JSON.stringify(box)}`);
}

async function contained(browser: Browser) {
  const size = await browser.evaluate(`({scroll:document.documentElement.scrollWidth,body:document.body.scrollWidth,width:innerWidth})`);
  assert.ok(size.scroll <= size.width + 1 && size.body <= size.width + 1, `Horizontal overflow: ${JSON.stringify(size)}`);
}

// Real CDP clicks catch covered/unclickable controls; element.click() would not.
async function click(browser: Browser, selector: string) {
  await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  const point = await browser.evaluate(`(() => {
    const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();
    const x=r.x+r.width/2,y=r.y+r.height/2;
    return {x,y,hit:el.contains(document.elementFromPoint(x,y)),disabled:el.matches(':disabled')};
  })()`);
  assert.ok(point.hit && !point.disabled, `${selector} is not usable: ${JSON.stringify(point)}`);
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
}

async function cardSides(browser: Browser) {
  // Wait for the flip to finish before measuring/clicking the next face.
  for (const side of ['stats', 'events', 'live-taps', 'responses', 'front']) {
    const selector = byId(`button-living-card-${side}`);
    const target = await rect(browser, selector);
    assert.ok(target.width >= 44 && target.height >= 44, `${selector} retains a usable target: ${JSON.stringify(target)}`);
    await click(browser, selector);
    await browser.wait(`document.querySelector('.living-card-frame').dataset.side===${JSON.stringify(side)}`);
    await browser.evaluate(`Promise.all(document.querySelector('.living-card-frame').getAnimations({subtree:true}).filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);
    await proportion(browser, '.living-card-frame', 2 / 3);
    await contained(browser);
  }
}

async function editor(browser: Browser, width: number) {
  await browser.wait(`document.querySelector('[data-testid="fan-card-appearance-manager"]')`);
  await bounded(browser, byId('fan-card-appearance-manager'), 360);
  await proportion(browser, byId('classic-card-preview-surface'), 3 / 4);
  const selectors = ['classic-card-preview-surface', 'appearance-navigation-preview', 'hype-card-template-cyclers', 'photo-position-controls'];
  const boxes = [];
  for (const id of selectors) boxes.push(await rect(browser, byId(id)));
  for (let i = 1; i < boxes.length; i++) {
    assert.ok(boxes[i].y >= boxes[i - 1].bottom - 1, `Editor sequence must stay single-column at ${width}px: ${JSON.stringify(boxes)}`);
  }
  const arrows = await browser.evaluate(`Array.from(document.querySelectorAll('[data-testid="hype-card-template-cyclers"] button')).map(el=>el.dataset.testid)`);
  assert.equal(arrows.length, 4, 'frame and lower-third each have previous/next controls');
  for (const id of arrows) await click(browser, byId(id));
  const sliders = await browser.evaluate(`Array.from(document.querySelectorAll('[data-testid="photo-position-controls"] input[type="range"]')).map(el=>el.dataset.testid)`);
  assert.equal(sliders.length, 3, 'horizontal, vertical, and scale sliders remain available');
  for (const id of sliders) {
    await browser.evaluate(`document.querySelector(${JSON.stringify(byId(id))}).focus()`);
    const before = await browser.evaluate(`document.activeElement.value`);
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' });
    assert.notEqual(await browser.evaluate(`document.activeElement.value`), before, `${id} responds to keyboard input`);
  }
  await contained(browser);
}

export const responsiveRoutes = [
  '/studio/player-showcase',
  '/player/responsive-athlete/manage#design',
  '/showcase/responsive-athlete',
  '/fan/responsive-athlete',
] as const;

export async function checkResponsiveRoute(browser: Browser, route: string, width: number) {
  const desktop = width >= 1024;
  if (route.startsWith('/studio/')) {
    await browser.wait(`document.querySelector('[data-testid="showcase-card-art"]')`);
    await bounded(browser, '.ps', desktop ? 880 : width);
    await bounded(browser, '.ps-desktop-bounded', desktop ? 880 : width);
    await bounded(browser, byId('showcase-card-art'), desktop ? 260 : width, false);
    await proportion(browser, byId('showcase-card-art'), 2 / 3);
    for (const id of ['link-showcase-card-edit', 'link-showcase-card-public']) {
      const box = await rect(browser, byId(id));
      assert.ok(box.height >= 44, `${id} retains a usable target`);
    }
    assert.match(await browser.evaluate(`document.querySelector('[data-testid="link-showcase-card-edit"]').getAttribute('href')`), /\/player\/responsive-athlete\/manage#design$/);
    await contained(browser);
    await click(browser, byId('link-showcase-card-edit'));
    await browser.wait(`location.pathname.endsWith('/player/responsive-athlete/manage')&&location.hash==='#design'`);
    await editor(browser, width);
  } else if (route.startsWith('/player/')) {
    await browser.wait(`document.querySelector('[data-testid="owner-athlete-invite-management-page"]')`);
    await bounded(browser, '.ps-owner-manage', desktop ? 880 : width);
    const task = await rect(browser, byId('button-hype-manager-design'));
    if (desktop) assert.ok(task.height <= 132, `Manager tasks should stay compact: ${JSON.stringify(task)}`);
    await editor(browser, width);
    await click(browser, byId('button-hype-manager-design'));
    await browser.wait(`document.querySelector('[data-testid="button-hype-manager-design"]').getAttribute('aria-expanded')==='false'`);
    await click(browser, byId('button-hype-manager-design'));
    await browser.wait(`document.querySelector('[data-testid="button-hype-manager-design"]').getAttribute('aria-expanded')==='true'`);
  } else {
    await browser.wait(`document.querySelector('.living-card-frame')`);
    if (route.startsWith('/showcase/')) {
      await bounded(browser, '.public-showcase__hero', desktop ? 920 : width);
      await bounded(browser, '.public-showcase__topbar', desktop ? 960 : width);
      await bounded(browser, '.living-card-stage', desktop ? 380 : width, false);
    } else {
      await bounded(browser, '.living-card-main', desktop ? 960 : width);
      await bounded(browser, '.living-card-stage', desktop ? 440 : width);
    }
    await cardSides(browser);
  }
  await contained(browser);
  assert.deepEqual(await browser.evaluate('window.__unexpectedRequests'), [], 'All fixture API calls must be explicitly handled');
}
