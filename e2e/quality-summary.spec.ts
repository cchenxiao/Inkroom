import { expect, test } from '@playwright/test';
test('quality guidance stays compact in both themes and exposes grounded evidence', async ({
  page,
}, info) => {
  await page.route('**/quality-acceptance', async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({
      response,
      body: html.replace(/\/src\/main\.tsx[^" ]*/g, '/e2e/fixtures/quality-acceptance.tsx'),
    });
  });
  await page.route('**/go-api/**', (route) => route.abort());
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto('/quality-acceptance');
  const section = page.getByRole('region', { name: '篇幅与衔接' });
  await expect(section).toBeVisible();
  await expect(
    page.getByText('布袋已经入柜，后文又出现在桌上，缺少取回的动作。'),
  ).not.toBeVisible();
  const box = await section.boundingBox();
  expect(box!.height).toBeLessThan(240);
  await page.getByText('衔接核对 · 1 段待处理').click();
  await expect(page.getByText('她把蓝布袋放进铁柜，关上柜门。')).toBeVisible();
  for (const theme of ['day', 'night']) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`quality-${theme}.png`) });
  }
});

test('incomplete review is readable in both themes and retry is explicit', async ({
  page,
}, info) => {
  await page.route('**/quality-acceptance?failed=1', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        /\/src\/main\.tsx[^" ]*/g,
        '/e2e/fixtures/quality-acceptance.tsx',
      ),
    });
  });
  await page.route('**/go-api/**', (route) => route.abort());
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto('/quality-acceptance?failed=1');
  await expect(page.getByRole('status', { name: '检查未完成' })).toBeVisible();
  await expect(page.getByText(/达到输出上限/)).toBeVisible();
  for (const theme of ['day', 'night']) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`failure-${theme}.png`) });
  }
  await expect(page).not.toHaveTitle('review-retry-requested');
  await page.getByRole('button', { name: '保留正文，重新检查整章' }).click();
  await expect(page).toHaveTitle('review-retry-requested');
});

test('waiting progress is compact and readable at 80 seconds in both themes', async ({
  page,
}, info) => {
  await page.route('**/quality-acceptance?progress=1', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        /\/src\/main\.tsx[^" ]*/g,
        '/e2e/fixtures/quality-acceptance.tsx',
      ),
    });
  });
  await page.route('**/go-api/**', (route) => route.abort());
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto('/quality-acceptance?progress=1');
  const progress = page.getByRole('region', { name: '检查进度' });
  await expect(progress).toBeVisible();
  await expect(progress.getByText(/已等待 8\d 秒/)).toBeVisible();
  await expect(progress.getByText('核对事实与设定')).toBeVisible();
  expect((await progress.boundingBox())!.height).toBeLessThan(180);
  for (const theme of ['day', 'night']) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`progress-${theme}.png`) });
  }
});

test('failed evidence validation explains the cause, saved prose and explicit recovery', async ({
  page,
}, info) => {
  await page.route('**/quality-acceptance?failed=quote', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        /\/src\/main\.tsx[^" ]*/g,
        '/e2e/fixtures/quality-acceptance.tsx',
      ),
    });
  });
  await page.route('**/go-api/**', (route) => route.abort());
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto('/quality-acceptance?failed=quote');
  const failure = page.getByRole('status', { name: '检查未完成' });
  await expect(failure).toHaveCount(1);
  await expect(failure.getByText('一致性审核未完成')).toBeVisible();
  await expect(failure.getByText(/在本次目标正文中找不到原句/)).toBeVisible();
  await expect(failure.getByText(/语言审查已完成/)).toBeVisible();
  await expect(failure.getByText(/不会重写正文/)).toBeVisible();
  await expect(page.getByText(/运行未完成，保留最后成功落库/)).toHaveCount(0);
  for (const theme of ['day', 'night']) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`actionable-failure-${theme}.png`) });
  }
  await failure.getByRole('button', { name: '保留正文，重新检查整章' }).click();
  await expect(page).toHaveTitle('review-retry-requested');
});
