import {describe,it,expect} from 'vitest';
import {decodeSSE} from '@/shared/lib/sse';
describe('SSE transport',()=>{
 it('buffers partial network frames and decodes multiline records',()=>{const first='id: 12\nevent: node.started\ndata: {"runId":"r1",\ndata: "draftVersion":3,"data":{"node":"style"}}\n\n';const next='event: draft.delta\ndata: {"id":"13"';const parsed=decodeSSE(first+next);expect(parsed.events[0]).toMatchObject({id:'12',type:'node.started',runId:'r1',draftVersion:3,data:{node:'style'}});expect(parsed.rest).toBe(next);});
 it('ignores heartbeats/malformed packets without losing later events',()=>{const parsed=decodeSSE(':ping\n\ndata: broken\n\ndata: {"id":"next","type":"run.finished"}\n\n');expect(parsed.events).toHaveLength(1);expect(parsed.events[0].id).toBe('next');});
});
