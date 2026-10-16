import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RunEvent, RunNode } from '@/types/domain';
interface UIState {
  projectId: string;
  setProject: (projectId: string, chapterId: string, branchId?: string) => void;
  theme: 'day' | 'night';
  setTheme: (value: 'day' | 'night') => void;
  attention: 'review' | 'conflicts' | null;
  setAttention: (value: 'review' | 'conflicts' | null) => void;
  navCollapsed: boolean;
  setNavCollapsed: (value: boolean) => void;
  maxRounds: 2 | 3;
  setMaxRounds: (value: 2 | 3) => void;
  leftOpen: boolean;
  rightOpen: boolean;
  focus: boolean;
  heatmap: boolean;
  commandOpen: boolean;
  drawer: 'closed' | 'half' | 'full';
  drawerTab: string;
  selectedSegment: string | null;
  selectedFinding: string | null;
  chapterId: string;
  branchId: string;
  stale: boolean;
  node: RunNode | null;
  runId: string | null;
  events: RunEvent[];
  streamText: string;
  setPanel: (side: 'left' | 'right', value: boolean) => void;
  setFocus: (v: boolean) => void;
  setHeatmap: (v: boolean) => void;
  setCommand: (v: boolean) => void;
  setDrawer: (v: UIState['drawer']) => void;
  setDrawerTab: (v: string) => void;
  selectSegment: (id: string | null) => void;
  selectFinding: (id: string | null) => void;
  setChapter: (id: string) => void;
  setBranch: (id: string) => void;
  setStale: (v: boolean) => void;
  setRun: (id: string) => void;
  addEvent: (e: RunEvent) => void;
  clearStream: () => void;
}
export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      projectId: 'project-zhuoliu',
      setProject: (projectId, chapterId, branchId = 'main') =>
        set({
          projectId,
          chapterId,
          branchId,
          stale: false,
          attention: null,
          focus: false,
          drawer: 'closed',
          selectedSegment: null,
          selectedFinding: null,
          runId: null,
          node: null,
          events: [],
          streamText: '',
        }),
      theme: 'day',
      setTheme: (theme) => set({ theme }),
      attention: null,
      setAttention: (attention) =>
        set(
          attention
            ? { attention, drawer: 'closed', rightOpen: false, focus: false }
            : { attention },
        ),
      navCollapsed: false,
      setNavCollapsed: (navCollapsed) => set({ navCollapsed }),
      maxRounds: 2,
      setMaxRounds: (maxRounds) => set({ maxRounds }),
      leftOpen: true,
      rightOpen: false,
      focus: false,
      heatmap: true,
      commandOpen: false,
      drawer: 'closed',
      drawerTab: 'flow',
      selectedSegment: null,
      selectedFinding: null,
      chapterId: 'ch7',
      branchId: 'main',
      stale: false,
      node: null,
      runId: null,
      events: [],
      streamText: '',
      setPanel: (side, value) => set(side === 'left' ? { leftOpen: value } : { rightOpen: value }),
      setFocus: (focus) => set({ focus }),
      setHeatmap: (heatmap) => set({ heatmap }),
      setCommand: (commandOpen) => set({ commandOpen }),
      setDrawer: (drawer) => set({ drawer }),
      setDrawerTab: (drawerTab) => set({ drawerTab }),
      selectSegment: (selectedSegment) => set({ selectedSegment }),
      selectFinding: (selectedFinding) => set({ selectedFinding }),
      setChapter: (chapterId) =>
        set({
          chapterId,
          attention: null,
          selectedSegment: null,
          selectedFinding: null,
          stale: false,
          runId: null,
          node: null,
          events: [],
          streamText: '',
        }),
      setBranch: (branchId) =>
        set({
          branchId,
          attention: null,
          stale: false,
          runId: null,
          node: null,
          events: [],
          streamText: '',
        }),
      setStale: (stale) => set({ stale }),
      setRun: (runId) => set({ runId, events: [], streamText: '' }),
      addEvent: (event) =>
        set((s) =>
          s.events.some((e) => e.id === event.id)
            ? s
            : {
                events: [...s.events.slice(-99), event],
                node: event.data.node ?? s.node,
                streamText:
                  event.type === 'draft.delta'
                    ? s.streamText + (event.data.text ?? '')
                    : s.streamText,
                stale: event.type === 'version.stale' ? true : s.stale,
              },
        ),
      clearStream: () => set({ streamText: '' }),
    }),
    {
      name: 'inkloom-layout',
      version: 2,
      migrate: (persisted) => ({
        ...(persisted as UIState),
        rightOpen: false,
        drawer: 'closed',
        navCollapsed: false,
      }),
      partialize: (s) => ({
        theme: s.theme,
        navCollapsed: s.navCollapsed,
        leftOpen: s.leftOpen,
        rightOpen: s.rightOpen,

        heatmap: s.heatmap,
      }),
    },
  ),
);
