async (page) => {
  // Run after signing into the isolated local app with one of the QA admins.
  // Requires the six local QA records documented in the implementation report.
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  await page.goto('http://127.0.0.1:4180/guide');
  await page.getByRole('heading', { name: 'Guide', exact: true }).waitFor();
  const count = await page.locator('.gd-video-card').count();
  assert(count === 6, 'Expected the six isolated QA records');
  await page.locator('.gd-thumb img').evaluateAll(async images => {
    images.forEach(image => { image.loading = 'eager'; });
    await Promise.all(images.map(image => image.decode()));
  });
  const widths = [];
  for (const [width, height] of [[1440, 1000], [820, 1180], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const check = await page.evaluate(() => ({
      viewport: innerWidth, document: document.documentElement.scrollWidth,
      broken: [...document.querySelectorAll('.gd-thumb img')].filter(img => img.complete && !img.naturalWidth).length,
    }));
    assert(check.document === width && check.broken === 0, `Layout or media failed at ${width}px`);
    widths.push(check);
  }
  await page.getByRole('searchbox', { name: 'Search guides' }).fill('capacity');
  assert(await page.locator('.gd-video-card').count() === 1, 'Description search failed');
  await page.getByRole('button', { name: 'Payments', exact: true }).click();
  await page.getByRole('heading', { name: 'No matching guides' }).waitFor();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  assert(await page.locator('.gd-video-card').count() === count, 'Reset failed');
  await page.getByRole('button', { name: /Watch walkthrough/ }).click();
  await page.locator('video').waitFor();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.locator('video').evaluate(video => video.play());
  await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0.2);
  const duration = await page.locator('video').evaluate(video => video.duration);
  await page.keyboard.press('Escape');
  assert((await page.evaluate(() => document.activeElement?.textContent)).includes('Watch walkthrough'), 'Player focus restoration failed');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  assert(await page.getByRole('dialog').getByRole('link', { name: 'Guide', exact: true }).count() === 1, 'Mobile Guide destination missing');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert(await page.locator('.gd-video-card').first().evaluate(el => getComputedStyle(el).transitionDuration) === '0s', 'Reduced motion failed');
  return { widths, count, duration, search: 'pass', focus: 'pass', mobileGuide: 'pass', reducedMotion: 'pass' };
}
