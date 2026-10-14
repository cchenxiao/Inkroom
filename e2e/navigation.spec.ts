import { expect, test } from '@playwright/test';

test('all six routes render and narrow desktop panels remain accessible', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/workspace');
  await expect(page.getByRole('heading', { name: '夜谈', exact: true })).toBeVisible();
  for (const [label, path] of [
    ['创作准备', 'prepare'],
    ['人工审核', 'review'],
    ['变更与冲突', 'changes'],
    ['版本与分支', 'versions'],
    ['全稿与评测', 'reports'],
  ]) {
    await page.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/' + path + '$'));
    await expect(page.locator('h1')).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: '文风趋势', exact: true })).toBeVisible();
  await expect(page.locator('[aria-label="数据可视化图表"] svg').first()).toBeVisible();
  await page.getByRole('link', { name: '章节工作台', exact: true }).click();
  await page.setViewportSize({ width: 1100, height: 850 });
  await expect(page.getByRole('heading', { name: '夜谈', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '切换系统信念 ⌘B', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '系统信念', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '切换章节结构', exact: true }).click();
  await page.getByRole('button', { name: '切换系统信念 ⌘B', exact: true }).click();
  await expect(page.locator('.chapter-sidebar')).toBeVisible();
  await expect(page.locator('.bible-sidebar')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('default-workspace.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('streamed run has bounded retry budget and outdated review is blocked', async ({ page }) => {
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Agent 工作台', exact: true }).click();
  await page.getByRole('combobox', { name: '下次返工上限', exact: true }).selectOption('3');
  await page.getByRole('button', { name: '让 Agent 继续', exact: true }).click();
  await expect(page.getByRole('button', { name: '快进演示', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '快进演示', exact: true }).click();
  await expect(page.getByText('已上报人工', { exact: true })).toBeVisible();
  await expect(page.locator('.rework-counter')).toContainText('3/3');
  await page.getByRole('button', { name: '上下文清单', exact: true }).click();
  await expect(page.locator('.manifest-panel')).toContainText('未纳入材料');
  await page.getByRole('button', { name: '搜索或执行命令', exact: true }).click();
  await page.getByRole('button', { name: '模拟另一窗口保存（验证审批失效）', exact: true }).click();
  await expect(page.locator('.stale-banner')).toBeVisible();
  await expect(page.getByRole('button', { name: '提交定稿', exact: true })).toBeDisabled();
});
