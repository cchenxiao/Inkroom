import { expect, test } from '@playwright/test';
test('review opens beside evidence, preserves prose and does not steal scrolling on refresh', async ({
  page,
}, info) => {
  await page.route('**/inline-review-check', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        /\/src\/main\.tsx[^" ]*/g,
        '/e2e/fixtures/inline-review.tsx',
      ),
    });
  });
  await page.route('**/go-api/**', (route) => route.abort());
  await page.goto('/inline-review-check');
  const mark = page.locator('[data-finding-id="finding"]');
  await mark.click();
  const card = page.getByRole('complementary', { name: '问题详情' });
  await expect(card).toBeVisible();
  const host = page.locator('.inline-review-host');
  expect(await host.evaluate((el) => el.previousElementSibling?.textContent)).toBe(
    '信封放在桌上，紧挨着布袋。',
  );
  expect(await host.evaluate((el) => el.nextElementSibling?.textContent)).toContain(
    '后续正文第1段',
  );
  const box = await card.boundingBox(),
    quote = await mark.boundingBox();
  expect(box!.y - (quote!.y + quote!.height)).toBeLessThan(50);
  await expect(page.getByLabel('正文改动次数')).toHaveText('0');
  for (const theme of ['day', 'night']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.setViewportSize({ width: 720, height: 900 });
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath(`inline-review-${theme}.png`),
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.locator('.manuscript-scroll').evaluate((el) => {
    el.scrollTop = 500;
  });
  const before = await page.locator('.manuscript-scroll').evaluate((el) => el.scrollTop);
  await page.getByRole('button', { name: /模拟审核状态刷新/ }).click();
  expect(await page.locator('.manuscript-scroll').evaluate((el) => el.scrollTop)).toBe(before);
  await page.locator('.manuscript-scroll').evaluate((el) => {
    el.scrollTop = 0;
  });
  await card.getByRole('button', { name: '我来修改' }).click();
  await expect(card.getByLabel('替换为')).toHaveValue('信封放在桌上，紧挨着布袋。');
  await card.getByRole('button', { name: '取消', exact: true }).click();
  await card.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByLabel('正文改动次数')).toHaveText('0');
  await expect(
    page.getByText('后续正文第1段。窗外的雨落在屋檐上，她翻开笔记，继续记录这一晚发生的事情。', {
      exact: true,
    }),
  ).toBeVisible();
});

test('finding actions edit the cited quote, send a scoped rewrite, and keep/reopen without changing prose', async ({
  page,
}, info) => {
  await page.route('**/inline-review-check', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        /\/src\/main\.tsx[^" ]*/g,
        '/e2e/fixtures/inline-review.tsx',
      ),
    });
  });
  await page.route('**/go-api/**', (route) => route.abort());
  await page.goto('/inline-review-check');
  await page.locator('[data-finding-id="finding"]').click();
  const card = page.getByRole('complementary', { name: '问题详情' });
  await card.getByRole('button', { name: '让模型修改', exact: true }).click();
  await card.getByLabel('修改要求').fill('请解释布袋如何回到桌上');
  await card.getByRole('button', { name: '发送给模型' }).click();
  const rewrite = JSON.parse((await page.getByLabel('提交操作').textContent()) || '{}');
  expect(rewrite.type).toBe('rewrite');
  expect(rewrite.rewrite.instruction).toContain('布袋刚被锁进铁柜');
  expect(rewrite.rewrite.instruction).toContain('请解释布袋如何回到桌上');
  expect(rewrite.rewrite.end - rewrite.rewrite.start).toBe(
    Array.from('信封放在桌上，紧挨着布袋。').length,
  );
  await expect(page.getByLabel('正文改动次数')).toHaveText('0');
  await card.getByRole('button', { name: '保留原文', exact: true }).click();
  await expect(card.getByLabel('保留理由')).toHaveCount(0);
  await expect(card.getByRole('button', { name: '确认保留原文' })).toHaveCount(0);
  await expect(card.getByText('作者保留原文', { exact: true })).toBeVisible();
  await expect(page.getByLabel('正文改动次数')).toHaveText('0');
  await card.getByRole('button', { name: '撤销保留' }).click();
  await expect(card.getByText('作者保留原文', { exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: '我来修改' }).click();
  await card.getByLabel('替换为').fill('她取回布袋，把信封放在旁边。');
  for (const theme of ['day', 'night']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.setViewportSize({ width: 720, height: 1000 });
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath(`finding-edit-${theme}.png`),
    });
  }
  await expect(page.getByLabel('正文改动次数')).toHaveText('0');
  await card.getByRole('button', { name: '保存修改并复检' }).click();
  await expect(page.getByLabel('正文改动次数')).toHaveText('1');
  const request = JSON.parse((await page.getByLabel('提交操作').textContent()) || '{}');
  expect(request.type).toBe('inline_edit');
  expect(request.text).toContain('她把布袋锁进铁柜。\n她取回布袋，把信封放在旁边。\n后续正文第1段');
});

test('three P3 findings stay stable while local previews and edits await one explicit batch review', async ({
  page,
}, info) => {
  await page.route('**/inline-review-check?local', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        /\/src\/main\.tsx[^" ]*/g,
        '/e2e/fixtures/inline-review.tsx',
      ),
    });
  });
  await page.route('**/go-api/**', (route) => route.abort());
  await page.goto('/inline-review-check?local');
  await page.locator('[data-finding-id="finding"]').click();
  let card = page.getByRole('complementary', { name: '问题详情' });
  await card.getByRole('button', { name: '让模型修改' }).click();
  await card.getByRole('button', { name: '生成修改预览' }).click();
  await expect(card.getByLabel('局部修改对照')).toBeVisible();
  await expect(page.getByLabel('正文改动次数')).toHaveText('0');
  for (const theme of ['day', 'night']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.setViewportSize({ width: 800, height: 1000 });
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath(`finding-preview-${theme}.png`),
    });
  }
  await card.getByRole('button', { name: '确认替换这处' }).click();
  await expect(page.getByLabel('正文改动次数')).toHaveText('1');
  await expect(page.getByLabel('完整复审次数')).toHaveText('0');
  await expect(page.getByLabel('问题数量')).toHaveText('3');
  await page.locator('[data-finding-id="second"]').click();
  card = page.getByRole('complementary', { name: '问题详情' });
  await card.getByRole('button', { name: '我来修改' }).click();
  await card.getByLabel('替换为').fill('她把布袋搁在窗边。');
  await card.getByRole('button', { name: '保存这处修改' }).click();
  await expect(page.getByLabel('正文改动次数')).toHaveText('2');
  await expect(page.getByLabel('完整复审次数')).toHaveText('0');
  await expect(page.locator('[data-finding-id="third"]')).toBeVisible();
  await expect(page.getByLabel('问题数量')).toHaveText('3');
  await page.getByRole('button', { name: '统一复审当前稿' }).click();
  await expect(page.getByLabel('完整复审次数')).toHaveText('1');
});

test('model text and findings update without replacing the editor or moving the reading position', async ({
  page,
}) => {
  await page.route('**/inline-review-check', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        /\/src\/main\.tsx[^" ]*/g,
        '/e2e/fixtures/inline-review.tsx',
      ),
    });
  });
  await page.route('**/go-api/**', (route) => route.abort());
  await page.goto('/inline-review-check');
  await page.locator('[data-finding-id="finding"]').click();
  await expect(page.getByRole('complementary', { name: '问题详情' })).toBeVisible();
  const editor = page.locator('.tiptap');
  const original = await editor.elementHandle();
  await page.locator('.manuscript-scroll').evaluate((el) => {
    el.scrollTop = 650;
  });
  const before = await page.locator('.manuscript-scroll').evaluate((el) => el.scrollTop);
  await page.getByRole('button', { name: '模拟模型返回新正文和检查结果' }).click();
  await expect(editor).toContainText('信封放在桌上，紧挨着笔记。');
  await expect(editor.locator('[data-finding-id="finding"]')).toHaveCount(0);
  expect(await editor.evaluate((el, previous) => el === previous, original)).toBe(true);
  // Allow queued browser selection and smooth-scroll work to settle.
  await expect
    .poll(() => page.locator('.manuscript-scroll').evaluate((el) => el.scrollTop))
    .toBe(before);
  await page.waitForTimeout(400);
  expect(await page.locator('.manuscript-scroll').evaluate((el) => el.scrollTop)).toBe(before);
  await expect(page.getByLabel('正文改动次数')).toHaveText('0');
});
