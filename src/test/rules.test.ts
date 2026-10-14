import {describe,it,expect} from 'vitest';
import {routeFinding,finalizeBlockers} from '@/shared/lib/rules';
import type {QualityGateScores} from '@/types/domain';
describe('分级修订和定稿门禁',()=>{
 it.each([['P0','structural_reviser'],['P1','scene_reviser'],['P2','micro_polisher'],['P3','human_gate']] as const)('%s 路由到 %s',(severity,node)=>expect(routeFinding({severity})).toBe(node));
 it('未校准分低不应阻断，过期审批必须阻断',()=>{const scores:QualityGateScores={p0Count:0,canFinalize:true,blockers:[],items:[{key:'reader',label:'读者',value:1,threshold:5,direction:'higher',calibrated:false,passed:false,features:[]}]};expect(finalizeBlockers(scores,false)).toEqual([]);expect(finalizeBlockers(scores,true)).toContain('稿本已变更，旧审批失效');});
 it('P0和已校准未达标项必须阻断',()=>{const scores:QualityGateScores={p0Count:1,canFinalize:false,blockers:[],items:[{key:'aiTaste',label:'AI 味',value:80,threshold:30,direction:'lower',calibrated:true,passed:false,features:[]}]};expect(finalizeBlockers(scores,false)).toEqual(['仍有 1 处 P0 硬伤','AI 味未达标']);});
});
