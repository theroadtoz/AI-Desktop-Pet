export type ChatTurnLifecycleEcho = "正在回复" | "回复完成" | "回复失败" | "已中断";

export type ChatTurnNoteState = "ready" | "fallback" | "error";

export type ChatTurnState = {
  isReplying: boolean;
  activeRequestVersion: number | null;
  latestRequestVersion: number;
  activeReplyMessageId: string | null;
  activeReplyContent: string;
};

export type ChatTurnStartResult = {
  state: ChatTurnState;
  requestVersion: number;
};

export type ChatTurnDeltaResult = {
  accepted: boolean;
  state: ChatTurnState;
  content: string;
};

export type ChatTurnFinishResult = {
  accepted: boolean;
  state: ChatTurnState;
  lifecycleEcho: ChatTurnLifecycleEcho;
  sessionNote: string;
  sessionNoteState: ChatTurnNoteState;
};

export function createInitialChatTurnState(): ChatTurnState {
  return {
    isReplying: false,
    activeRequestVersion: null,
    latestRequestVersion: 0,
    activeReplyMessageId: null,
    activeReplyContent: ""
  };
}

export function startChatTurn(state: ChatTurnState, replyMessageId: string): ChatTurnStartResult {
  const requestVersion = state.latestRequestVersion + 1;

  return {
    requestVersion,
    state: {
      isReplying: true,
      activeRequestVersion: requestVersion,
      latestRequestVersion: requestVersion,
      activeReplyMessageId: replyMessageId,
      activeReplyContent: ""
    }
  };
}

export function shouldAcceptChatTurnEvent(state: ChatTurnState, requestVersion: number): boolean {
  return state.isReplying && state.activeRequestVersion === requestVersion;
}

export function applyChatTurnDelta(
  state: ChatTurnState,
  requestVersion: number,
  text: string
): ChatTurnDeltaResult {
  if (!shouldAcceptChatTurnEvent(state, requestVersion)) {
    return {
      accepted: false,
      state,
      content: state.activeReplyContent
    };
  }

  const nextState = {
    ...state,
    activeReplyContent: `${state.activeReplyContent}${text}`
  };

  return {
    accepted: true,
    state: nextState,
    content: nextState.activeReplyContent
  };
}

export function finishChatTurn(
  state: ChatTurnState,
  requestVersion: number,
  lifecycleEcho: ChatTurnLifecycleEcho = "回复完成"
): ChatTurnFinishResult {
  if (!shouldAcceptChatTurnEvent(state, requestVersion)) {
    return {
      accepted: false,
      state,
      lifecycleEcho,
      ...formatChatTurnFinish(lifecycleEcho)
    };
  }

  return {
    accepted: true,
    state: {
      ...state,
      isReplying: false,
      activeRequestVersion: null,
      activeReplyMessageId: null,
      activeReplyContent: ""
    },
    lifecycleEcho,
    ...formatChatTurnFinish(lifecycleEcho)
  };
}

export function formatChatTurnFinish(lifecycleEcho: ChatTurnLifecycleEcho): {
  sessionNote: string;
  sessionNoteState: ChatTurnNoteState;
} {
  if (lifecycleEcho === "回复完成") {
    return {
      sessionNote: "她刚说完，可以继续聊。",
      sessionNoteState: "ready"
    };
  }

  if (lifecycleEcho === "回复失败") {
    return {
      sessionNote: "她暂时没接上模型，稍后再试或检查连接。",
      sessionNoteState: "error"
    };
  }

  if (lifecycleEcho === "已中断") {
    return {
      sessionNote: "这轮先停在这里，未完成的回复不会保存。",
      sessionNoteState: "fallback"
    };
  }

  return {
    sessionNote: "她在想怎么说，可随时停下。",
    sessionNoteState: "ready"
  };
}
