import assert from 'node:assert/strict';
import { longShowcaseLabels, type ShowcaseGeometryScenario } from './showcase-responsive-fixture';

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

// Check the actual text bounds too: overflow:hidden can hide broken labels
// without making the document wider.
async function readable(browser: Browser, selector: string, action = false, minimumFont = 11) {
  const box = await rect(browser, selector);
  assert.ok(box.x >= -1 && box.right <= box.viewport + 1, `${selector} escapes viewport: ${JSON.stringify(box)}`);
  const text = await browser.evaluate(`(() => {
    const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();
    const range=document.createRange();range.selectNodeContents(el);
    const bounds=Array.from(range.getClientRects()).filter(b=>b.width&&b.height);
    return {label:el.matches('select')?el.selectedOptions[0]?.textContent:el.textContent.trim(),font:parseFloat(getComputedStyle(el).fontSize),lineHeight:getComputedStyle(el).lineHeight,
      box:{width:r.width,height:r.height,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight},
      textBounds:bounds.map(b=>({left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height})),
      fits:el.matches('select')||bounds.every(b=>b.left>=r.left-1&&b.right<=r.right+1&&(!${action}||(b.top>=r.top-1&&b.bottom<=r.bottom+1))),
      scrollFits:el.scrollWidth<=el.clientWidth+1&&(!${action}||el.scrollHeight<=el.clientHeight+1)};
  })()`);
  assert.ok(text.label && text.font >= minimumFont && text.fits && text.scrollFits, `${selector} clips its label: ${JSON.stringify(text)}`);
  if (action) {
    assert.ok(box.width >= 44 && box.height >= 42, `${selector} retains a usable target: ${JSON.stringify(box)}`);
    await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
    assert.ok(await browser.evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();return !el.matches(':disabled')&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`), `${selector} is covered or disabled`);
  }
}

export async function checkShowcaseEdgeGeometry(browser: Browser, route: string, width: number, scenario: ShowcaseGeometryScenario) {
  const desktop = width >= 1024;
  if (scenario === 'delayed-owner-invites') {
    assert.ok(route.startsWith('/studio/'), 'Delayed owner-invite geometry runs on the owner Showcase');
    await browser.wait(`typeof window.__pendingFixtureRequests['owner-invites']==='function'`);
    await browser.wait(`document.querySelector('[data-testid="status-showcase-card-unavailable"] strong')?.textContent==='Loading the saved card…'`);
    await bounded(browser, '.ps', desktop ? 880 : width);
    await bounded(browser, '.ps__card-unavailable', 460, false);
    await readable(browser, '.ps__card-unavailable strong');
    await readable(browser, '.ps__card-unavailable > span');
    await browser.evaluate(`window.__releaseFixtureRequest('owner-invites')`);
    await browser.wait(`document.querySelector('[data-testid="showcase-hype-card-preview"]')`);
    await bounded(browser, byId('showcase-card-art'), desktop ? 390 : width, false);
  } else if (scenario === 'delayed-fan-card') {
    await browser.wait(`typeof window.__pendingFixtureRequests['fan-card']==='function'`);
    if (route.startsWith('/studio/')) {
      await browser.wait(`document.querySelector('[data-testid="status-showcase-card-unavailable"] strong')?.textContent==='Loading the saved card…'`);
      await bounded(browser, '.ps', desktop ? 880 : width);
      await bounded(browser, '.ps__card-unavailable', 460, false);
      await readable(browser, '.ps__card-unavailable strong');
      await readable(browser, '.ps__card-unavailable > span');
    } else {
      await browser.wait(`document.querySelector('[data-testid="status-public-showcase-loading"]')`);
      await bounded(browser, '.public-showcase__state-panel', desktop ? 560 : width);
      await readable(browser, '.public-showcase__loading-copy', false, 10);
    }
    await browser.evaluate(`window.__releaseFixtureRequest('fan-card')`);
    if (route.startsWith('/studio/')) {
      await browser.wait(`document.querySelector('[data-testid="showcase-hype-card-preview"]')`);
      await bounded(browser, byId('showcase-card-art'), desktop ? 390 : width, false);
    } else {
      await browser.wait(`document.querySelector('.living-card-frame')`);
      await bounded(browser, '.public-showcase__hero', desktop ? 920 : width);
      await bounded(browser, '.living-card-stage', desktop ? 380 : width, false);
    }
  } else if (scenario === 'retry-owner') {
    assert.ok(route.startsWith('/studio/'), 'Owner retry geometry runs on the owner Showcase');
    await browser.wait(`document.querySelector('[data-testid="status-showcase-card-unavailable"] strong')?.textContent==='HYPE Card unavailable'`);
    await bounded(browser, '.ps__card-unavailable', 460, false);
    await readable(browser, byId('button-showcase-card-retry'), true);
    await click(browser, byId('button-showcase-card-retry'));
    await browser.wait(`document.querySelector('[data-testid="showcase-hype-card-preview"]')`);
    assert.equal(await browser.evaluate(`window.__fixtureAttempts.fanCard`), 2, 'Owner retry makes a second fan-card request');
    await readable(browser, '.ps__card-only-team');
    await bounded(browser, byId('showcase-card-art'), desktop ? 390 : width, false);
  } else if (scenario === 'retry-public') {
    assert.ok(route.startsWith('/showcase/'), 'Public retry geometry runs on the public Showcase');
    await browser.wait(`document.querySelector('[data-testid="status-public-showcase-unavailable"]')`);
    await bounded(browser, '.public-showcase__state-panel', desktop ? 560 : width);
    await readable(browser, byId('button-public-showcase-retry'), true);
    const attemptsBeforeRetry = await browser.evaluate(`window.__fixtureAttempts.fanCard`);
    await click(browser, byId('button-public-showcase-retry'));
    await browser.wait(`document.querySelector('.living-card-frame')`);
    assert.ok(await browser.evaluate(`window.__fixtureAttempts.fanCard`) > attemptsBeforeRetry, 'Public retry makes a new fan-card request');
    await bounded(browser, '.public-showcase__hero', desktop ? 920 : width);
    await bounded(browser, '.living-card-stage', desktop ? 380 : width, false);
    assert.ok(await browser.evaluate(`document.querySelector('[data-testid="text-public-showcase-name"]')?.textContent.includes(${JSON.stringify(longShowcaseLabels.athleteName)})`), 'Retry displays the successful athlete card');
  } else if (route.startsWith('/studio/')) {
    await browser.wait(scenario === 'long-labels'
      ? `document.querySelector('[data-testid="showcase-card-art"]')`
      : `document.querySelector('[data-testid="status-showcase-card-unavailable"] strong')?.textContent===${JSON.stringify({
        missing: 'No HYPE Card linked', unavailable: 'HYPE Card unavailable', ambiguous: 'Choose a HYPE Card', 'not-shared': 'HYPE Card not shared',
      }[scenario as 'missing' | 'unavailable' | 'ambiguous' | 'not-shared'])}`);
    await bounded(browser, '.ps', desktop ? 880 : width);
    await bounded(browser, '.ps-desktop-bounded', desktop ? 880 : width);
    await readable(browser, byId('link-back-supporter-dashboard'), true);
    if (scenario === 'long-labels') {
      assert.equal(await browser.evaluate(`document.querySelector('.ps__card-only-team').textContent`), longShowcaseLabels.teamName);
      await readable(browser, '.ps__card-only-team');
      await bounded(browser, byId('showcase-card-art'), desktop ? 260 : width, false);
      await proportion(browser, byId('showcase-card-art'), 2 / 3);
      for (const id of ['link-showcase-card-edit', 'link-showcase-card-public']) await readable(browser, byId(id), true);
    } else {
      await bounded(browser, '.ps__card-unavailable', 460, false);
      for (const selector of ['.ps__card-unavailable strong', '.ps__card-unavailable > span']) await readable(browser, selector);
      if (scenario === 'ambiguous') {
        // Both picker placements must stay bounded, even with long native options.
        for (const selector of ['.ps__card-only > .ps__card-picker', '.ps__card-unavailable .ps__card-picker']) {
          await bounded(browser, selector, selector.includes(' > ') ? 520 : 360, false);
          await readable(browser, `${selector} select`, true);
          assert.deepEqual(await browser.evaluate(`Array.from(document.querySelector(${JSON.stringify(selector + ' select')}).options).slice(1).map(o=>o.textContent.trim())`), [
            `Soccer · ${longShowcaseLabels.seasonName} · Regional qualification`,
            `Soccer · ${longShowcaseLabels.seasonName} · National championship`,
          ]);
        }
      } else {
        await readable(browser, byId('link-showcase-card-edit-unavailable'), true);
        if (scenario === 'unavailable') await readable(browser, byId('button-showcase-card-retry'), true);
      }
    }
  } else if (route.startsWith('/showcase/')) {
    if (scenario === 'unavailable') {
      await browser.wait(`document.querySelector('[data-testid="status-public-showcase-unavailable"]')`);
      await bounded(browser, '.public-showcase__state-panel', desktop ? 560 : width);
      await readable(browser, '.public-showcase__state-panel h1');
      await readable(browser, byId('button-public-showcase-retry'), true);
    } else {
      await browser.wait(`document.querySelector('.living-card-frame')`);
      await bounded(browser, '.public-showcase__hero', desktop ? 920 : width);
      await bounded(browser, '.public-showcase__topbar', desktop ? 960 : width);
      assert.equal(await browser.evaluate(`document.querySelector('[data-testid="text-public-showcase-name"]').textContent`), longShowcaseLabels.athleteName + '.');
      await readable(browser, byId('text-public-showcase-name'));
      await readable(browser, '.public-showcase__identity');
      await bounded(browser, '.living-card-stage', desktop ? 380 : width, false);
      await proportion(browser, '.living-card-frame', 2 / 3);
      await readable(browser, byId('link-owner-back-to-showcase'), true);
    }
  } else if (route.startsWith('/player/')) {
    await browser.wait(`document.querySelector('[data-testid="fan-card-appearance-manager"]')`);
    await bounded(browser, '.ps-owner-manage', desktop ? 880 : width);
    await bounded(browser, byId('fan-card-appearance-manager'), 360);
    await proportion(browser, byId('classic-card-preview-surface'), 3 / 4);
    await readable(browser, byId('button-hype-manager-design'), true);
  } else {
    await browser.wait(`document.querySelector('.living-card-frame')`);
    await bounded(browser, '.living-card-main', desktop ? 960 : width);
    await bounded(browser, '.living-card-stage', desktop ? 440 : width);
    await proportion(browser, '.living-card-frame', 2 / 3);
  }
  await contained(browser);
  assert.deepEqual(await browser.evaluate('window.__unexpectedRequests'), [], 'Edge fixtures must explicitly handle all requests');
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

async function keyboardFocusable(browser: Browser, selector: string) {
  const target = await browser.evaluate(`(() => {
    const el=document.querySelector(${JSON.stringify(selector)});
    if(!el) throw new Error('Missing keyboard target: '+${JSON.stringify(selector)});
    const visible=element=>{
      const style=getComputedStyle(element),r=element.getBoundingClientRect();
      return style.display!=='none'&&style.visibility!=='hidden'&&r.width>0&&r.height>0;
    };
    const candidates=Array.from(document.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')).filter(visible);
    const index=candidates.indexOf(el);
    if(index<0) throw new Error('Target is not in the keyboard tab order: '+${JSON.stringify(selector)});
    if(index===0) document.body.tabIndex=-1;
    (index===0?document.body:candidates[index-1]).focus();
    return {index,tag:el.tagName};
  })()`);
  assert.ok(target.index >= 0, `${selector} is in the tab order`);
  await browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.ok(await browser.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`), `${selector} receives keyboard focus with Tab`);
}

async function enlargeText(browser: Browser, selectors: string[]) {
  const sizes = await browser.evaluate(`(() => {
    const selectors=${JSON.stringify(selectors)};
    return selectors.map(selector=>{
      const el=document.querySelector(selector);
      if(!el) throw new Error('Missing enlarged-text target: '+selector);
      const before=parseFloat(getComputedStyle(el).fontSize);
      el.style.setProperty('font-size',(before*2)+'px','important');
      return {selector,before,after:parseFloat(getComputedStyle(el).fontSize)};
    });
  })()`);
  for (const size of sizes) {
    assert.equal(size.after, size.before * 2, `${size.selector} uses 200% text: ${JSON.stringify(size)}`);
  }
}

export async function checkShowcaseEnlargedText(
  browser: Browser,
  route: string,
  width: number,
  scenario: 'long-labels' | 'ambiguous' | 'retry-public',
) {
  const desktop = width >= 1024;
  if (scenario === 'long-labels') {
    assert.ok(route.startsWith('/studio/'), 'Enlarged owner-label checks run on the owner Showcase');
    await browser.wait(`document.querySelector('[data-testid="showcase-card-art"]')`);
    await enlargeText(browser, ['.ps__card-only-team', byId('link-showcase-card-edit'), byId('link-showcase-card-public')]);
    assert.equal(await browser.evaluate(`document.querySelector('.ps__card-only-team').textContent`), longShowcaseLabels.teamName);
    await readable(browser, '.ps__card-only-team');
    for (const id of ['link-showcase-card-edit', 'link-showcase-card-public']) {
      await readable(browser, byId(id), true);
      await keyboardFocusable(browser, byId(id));
    }
    await bounded(browser, '.ps', desktop ? 880 : width);
  } else if (scenario === 'ambiguous') {
    assert.ok(route.startsWith('/studio/'), 'Enlarged picker checks run on the owner Showcase');
    await browser.wait(`document.querySelector('[data-testid="status-showcase-card-unavailable"] strong')?.textContent==='Choose a HYPE Card'`);
    const pickers = ['.ps__card-only > .ps__card-picker', '.ps__card-unavailable .ps__card-picker'];
    await enlargeText(browser, pickers.flatMap((selector) => [selector, `${selector} select`]));
    for (const selector of pickers) {
      await readable(browser, `${selector} select`, true);
      await keyboardFocusable(browser, `${selector} select`);
      assert.deepEqual(await browser.evaluate(`Array.from(document.querySelector(${JSON.stringify(`${selector} select`)}).options).slice(1).map(option=>option.textContent.trim())`), [
        `Soccer · ${longShowcaseLabels.seasonName} · Regional qualification`,
        `Soccer · ${longShowcaseLabels.seasonName} · National championship`,
      ]);
    }
    await bounded(browser, '.ps', desktop ? 880 : width);
  } else {
    assert.ok(route.startsWith('/showcase/'), 'Enlarged retry checks run on the public Showcase');
    await browser.wait(`document.querySelector('[data-testid="status-public-showcase-unavailable"]')`);
    await enlargeText(browser, [
      '.public-showcase__state-panel h1',
      '.public-showcase__state-panel > p:not(.public-showcase__eyebrow)',
      byId('button-public-showcase-retry'),
    ]);
    await bounded(browser, '.public-showcase__state-panel', desktop ? 560 : width);
    await readable(browser, '.public-showcase__state-panel h1');
    await readable(browser, '.public-showcase__state-panel > p:not(.public-showcase__eyebrow)');
    await readable(browser, byId('button-public-showcase-retry'), true);
    await keyboardFocusable(browser, byId('button-public-showcase-retry'));
  }
  await contained(browser);
  assert.deepEqual(await browser.evaluate('window.__unexpectedRequests'), [], 'Enlarged-text fixtures must explicitly handle all requests');
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
