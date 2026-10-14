import { expect, test } from '@playwright/test';

test('author keeps control of a suggestion and resolves a conflict with an explicit reason', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  const writes: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(request.url());
  });
  await page.goto('/workspace');
  const originalSegment = page.getByTestId('editor-ch7-s3');
  await expect(originalSegment).toContainText('一股难以言喻的情绪涌上心头');
  await expect(page.getByText('所有修改已保存', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  await expect(page.getByRole('button', { name: '提交定稿', exact: true })).toBeDisabled();

  // Visit the review surface and return through real navigation.
  await page.getByRole('link', { name: '人工审核', exact: true }).click();
  await expect(page.getByRole('heading', { name: '把最后的决定，留给作者' })).toBeVisible();
  await page.getByRole('link', { name: '章节工作台', exact: true }).click();
  const before = await originalSegment.innerText();
  await page.locator('[data-finding-id="f-p2-emotion"]').first().click();
  await page.getByRole('button', { name: '查看修改建议', exact: true }).click();
  await expect(page.getByRole('button', { name: '应用所选修改', exact: true })).toBeVisible();
  expect(await originalSegment.innerText()).toBe(before);
  await page.getByRole('button', { name: '应用所选修改', exact: true }).click();
  await expect(originalSegment).not.toContainText('一股难以言喻的情绪涌上心头');
  await expect(originalSegment).toContainText('铜扣硌着掌心');
  await expect(page.getByTestId('editor-ch7-s4')).toContainText('嘴角勾起一抹冷笑');

  // A lie is an author interpretation; it must not rewrite Bible facts.
  await page.getByRole('link', { name: '变更与冲突', exact: true }).click();
  const confirm = page.getByRole('button', { name: '确认裁决', exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByRole('button', { name: '以正文为准', exact: true }).click();
  await page.getByRole('checkbox', { name: '这是台词谎言或人物误解，不更新世界事实' }).check();
  await expect(confirm).toBeDisabled();
  await page
    .getByRole('textbox', { name: '说明判断依据' })
    .fill('角色故意隐瞒左手旧伤，保留已确认的人物设定。');
  await confirm.click();
  await expect(page.getByText('没有待裁决的事实冲突', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '章节工作台', exact: true }).click();
  await expect(page.getByTestId('editor-ch7-s5')).toContainText('用右手攥紧了刀');
  await page.screenshot({
    path: testInfo.outputPath('author-reviewed-manuscript.png'),
    fullPage: true,
  });
  expect(pageErrors).toEqual([]);
});

test('text selection creates an attached comment without overwriting the manuscript', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/workspace');
  const editor = page.getByTestId('editor-ch7-s1');
  await expect(editor).toBeVisible();
  const original = await editor.innerText();
  await editor.click();
  await editor.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await expect(page.getByRole('toolbar', { name: '选区操作' })).toBeVisible();
  await page.getByRole('button', { name: '添加批注', exact: true }).click();
  await page
    .getByRole('textbox', { name: '写下你的观察，或给 AI 一条具体的修改指令…' })
    .fill('保留雨夜的距离感。');
  await page.getByRole('button', { name: '保存批注', exact: true }).click();
  await page.getByRole('tab', { name: /批注/ }).click();
  await expect(page.getByText('保留雨夜的距离感。', { exact: true })).toBeVisible();
  expect(await editor.innerText()).toBe(original);
  await page.getByRole('tab', { name: '终稿', exact: true }).click();
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await page.getByRole('tab', { name: '正文', exact: true }).click();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  expect(pageErrors).toEqual([]);
});
