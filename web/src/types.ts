export type {
  EditableShot,
  SavedShot,
  SelectedShot,
  StoryboardDraft,
  StoryboardProposal,
} from '../../src/domain/storyboard';
export type { ChatAssetCardItem, ChatUiBlock } from '../../src/domain/chat-ui';
import type {
  SavedShot,
  SelectedShot,
  StoryboardDraft,
  StoryboardProposal,
} from '../../src/domain/storyboard';
import type { ChatUiBlock } from '../../src/domain/chat-ui';

export type Login = { token: string; expiresAt: string; user: { userId: string; username: string } };
export type Project = { projectId: string; name: string; updatedAt: string };
export type Session = {
  sessionId: string;
  projectId?: string | null;
  name: string;
  pinned?: boolean;
  createdAt: string;
  updatedAt?: string;
};
export type Version = { projectId: string; version: number; storyboard: StoryboardDraft<SavedShot> | null };
export type Asset = { id: string; name: string; type: 'image' | 'video'; url?: string };
export type Confirmation = {
  confirmationId: string;
  version: number;
  shotIds: string[];
  model: string;
  createdAt: string;
};
export type Message = {
  role: 'user' | 'assistant';
  content: string;
  sequence?: number;
  selectedShot?: Pick<SelectedShot, 'version'>;
  storyboardProposal?: StoryboardProposal;
  uiBlocks?: ChatUiBlock[];
  status?: string;
  runId?: string;
};
type Step = { kind: 'tool' | 'summary' | 'model'; name: string; status: string; durationMs?: number };
export type Run = { status: string; reason?: string; steps: Step[] };
type EventData =
  | { type: 'started' }
  | { type: 'step_started' | 'step_finished'; step: Step }
  | { type: 'ui_block'; block: ChatUiBlock }
  | { type: 'text_delta'; text: string; modelCallNumber: number }
  | {
      type: 'completed';
      text: string;
      storyboardProposal?: StoryboardProposal;
      uiBlocks?: ChatUiBlock[];
      sessionName?: string;
    }
  | { type: 'stopped'; text: string; sessionName?: string }
  | { type: 'failed'; statusCode?: number; message: string };
export type RunEvent = EventData & { sessionId: string; runId: string };
