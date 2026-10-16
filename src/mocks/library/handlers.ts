import { http, HttpResponse } from 'msw';
import type { BookBrief, PlanAction } from '@/types/domain/library';
import type { ChangeSet, Commit } from '@/types/domain';
import { ApiFailure, db } from '../data/db';
import { books, newBook, persistLibrary } from './store';
import { bookOverview, listBooks } from './overview';
import { applyPlan, validateBrief } from './planning';
const json = HttpResponse.json;
const problem = (status: number, code: string, message: string): never => {
  throw new ApiFailure(status, code, message);
};
export const libraryHandlers = [
  http.all('*/api/*', async ({ request }) => {
    const url = new URL(request.url),
      path = url.pathname.slice(url.pathname.indexOf('/api') + 4),
      method = request.method;
    const projectMatch = path.match(/^\/projects\/([^/]+)(.*)$/);
    const scope = projectMatch
      ? decodeURIComponent(projectMatch[1])
      : (url.searchParams.get('projectId') ?? db.project.id);
    const original = scope === db.project.id;
    const global = path === '/projects';
    const special = projectMatch && ['/overview', '/planning'].includes(projectMatch[2]);
    if (!global && !special && original) return; // 原单书业务/门禁保持原处理器，不切换全局 db。
    try {
      const body =
        method === 'GET' || method === 'DELETE'
          ? {}
          : ((await request.json()) as Record<string, unknown>);
      if (global && method === 'GET') return json(listBooks());
      if (global && method === 'POST') {
        validateBrief(body as unknown as BookBrief);
        const id = 'project-' + crypto.randomUUID();
        const b = newBook(id, body as unknown as BookBrief);
        books[id] = b;
        persistLibrary();
        return json(b.plan, { status: 201 });
      }
      const branchId = String(body.branchId ?? url.searchParams.get('branchId') ?? 'main');
      if (projectMatch?.[2] === '/overview' && method === 'GET')
        return json(bookOverview(scope, branchId) ?? problem(404, 'not_found', '作品或分支不存在'));
      const b = books[scope] ?? problem(404, 'project_not_found', '作品不存在，请返回作品库');
      if (projectMatch?.[2] === '/planning') {
        if (method === 'GET') return json(b.plan);
        if (method === 'PATCH') {
          books[scope] = applyPlan(b, Number(body.expectedVersion), body as unknown as PlanAction);
          persistLibrary();
          return json(books[scope].plan);
        }
      }
      const data = b.data[branchId] ?? problem(404, 'branch_not_found', '此作品中不存在该分支');
      const docs = Object.values(data.documents);
      if (projectMatch?.[2] === '' && method === 'GET') return json(b.project);
      if (projectMatch?.[2] === '/tree' && method === 'GET')
        return json(b.plan.steps[3].locked ? docs.map((d) => d.chapter) : []);
      if (path.startsWith('/chapters/') && method === 'GET')
        return json(
          data.documents[path.split('/')[2]] ??
            problem(404, 'chapter_not_found', '此作品中不存在该章节'),
        );
      if (path.startsWith('/bible/') && method === 'GET')
        return json(
          path.endsWith('/all')
            ? data.bible
            : (data.bible[path.split('/')[2] as keyof typeof data.bible] ??
                problem(404, 'not_found', '设定不存在')),
        );
      if (path === '/branches' && method === 'GET')
        return json(b.branches.filter((x) => x.status !== 'abandoned'));
      if (path === '/commits' && method === 'GET')
        return json(
          b.commits
            .filter(
              (c) =>
                c.branchId === branchId &&
                (!url.searchParams.get('chapterId') ||
                  c.chapterId === url.searchParams.get('chapterId')),
            )
            .slice()
            .reverse(),
        );
      if ((path === '/changesets' || path === '/conflicts') && method === 'GET') return json([]);
      if (path === '/exports' && method === 'GET')
        return json({
          filename: b.project.name + '.md',
          text:
            '# ' +
            b.project.name +
            '\n\n' +
            docs
              .map(
                (d) =>
                  '## ' + d.chapter.title + '\n\n' + d.segments.map((s) => s.text).join('\n\n'),
              )
              .join('\n\n'),
        });
      if (path.startsWith('/segments/') && method === 'PATCH') {
        if (!b.plan.steps[3].locked) problem(409, 'plan_not_locked', '章纲待确认，请先完成向导');
        const id = path.split('/')[2],
          doc =
            docs.find((d) => d.segments.some((s) => s.id === id)) ??
            problem(404, 'not_found', '段落不属于此作品');
        if (body.draftVersion !== doc.chapter.draftVersion)
          problem(409, 'version_mismatch', '正文版本已更新，请重新核对');
        if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 200000)
          problem(422, 'invalid_text', '正文不能为空或过长');
        const s = doc.segments.find((s) => s.id === id)!,
          old = s.text;
        s.text = body.text as string;
        s.version++;
        doc.chapter.draftVersion++;
        doc.chapter.status = 'drafting';
        doc.chapter.wordCount = doc.segments.reduce(
          (n, s) => n + Array.from(s.text.replace(/\s/g, '')).length,
          0,
        );
        doc.run.draftVersion = doc.chapter.draftVersion;
        const commit: Commit = {
          id: 'commit-' + crypto.randomUUID(),
          parentId: b.branches.find((x) => x.id === branchId)?.headCommit || null,
          branchId,
          chapterId: doc.chapter.id,
          title: '作者保存演示正文',
          author: 'human',
          createdAt: new Date().toISOString(),
          draftVersion: doc.chapter.draftVersion,
          summary: '仅保存在本地 Mock',
          oldText: old,
          newText: s.text,
        };
        b.commits.push(commit);
        b.branches.find((x) => x.id === branchId)!.headCommit = commit.id;
        b.project.currentChapterId = doc.chapter.id;
        b.updatedAt = commit.createdAt;
        b.status = 'writing';
        persistLibrary();
        const changeset: ChangeSet = {
          id: 'change-' + crypto.randomUUID(),
          origin: 'human_inline',
          targetType: 'segment',
          targetId: id,
          old,
          new: s.text,
          reason: '作者修改演示正文',
          blastRadius: [],
          conflicts: [],
          parentCommit: commit.parentId ?? '',
          draftVersion: doc.chapter.draftVersion,
          status: 'applied',
          createdAt: commit.createdAt,
        };
        return json({ draftVersion: doc.chapter.draftVersion, changeset });
      }
      if (path === '/branches' && method === 'POST') {
        if (typeof body.name !== 'string' || !body.name.trim())
          problem(422, 'name_required', '请输入分支名称');
        const source =
          b.data[String(body.fromBranchId ?? branchId)] ??
          problem(404, 'not_found', '来源分支不存在');
        const id = 'branch-' + crypto.randomUUID(),
          branch = {
            id,
            name: body.name as string,
            headCommit: '',
            description: '独立的本地演示试写，尚未接入真实检索',
            status: 'active' as const,
            createdAt: new Date().toISOString(),
            isMain: false,
          };
        b.branches.push(branch);
        b.data[id] = structuredClone(source);
        Object.values(b.data[id].documents).forEach((d) => {
          d.run.id = id + '-' + d.chapter.id;
          d.run.branchId = id;
        });
        persistLibrary();
        return json(branch);
      }
      if (path.startsWith('/branches/') && method === 'DELETE') {
        const branch =
          b.branches.find((x) => x.id === path.split('/')[2]) ??
          problem(404, 'not_found', '分支不存在');
        if (branch.isMain) problem(422, 'main_protected', '主线不能放弃');
        branch.status = 'abandoned';
        persistLibrary();
        return json(branch);
      }
      // 尤其禁止未知作品的写请求穿透，误触发浊流默认章节的模拟 Agent。
      return json(
        {
          code: 'demo_not_connected',
          message: '此作品仅支持向导规划与手动试写；评审、传播和合并尚未接线。',
        },
        { status: 501 },
      );
    } catch (error) {
      if (error instanceof ApiFailure)
        return json(
          { code: error.code, message: error.message, currentVersion: error.currentVersion },
          { status: error.status },
        );
      return json(
        {
          code: 'library_error',
          message: error instanceof Error ? error.message : '作品演示存储异常',
        },
        { status: 422 },
      );
    }
  }),
];
