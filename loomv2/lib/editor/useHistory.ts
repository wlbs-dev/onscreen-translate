// lib/editor/useHistory.ts
// Undo/redo for a single immutable value (the editor's overlay events).
//
//   set(update, { coalesceKey })  committed edit — pushes one history entry.
//                                 Repeated edits with the same key inside
//                                 COALESCE_MS fold into one entry (typing,
//                                 colour-picker drags, repeated nudges).
//   preview(update)               transient edit during a drag — updates the
//                                 value without touching history.
//   commit()                      ends the drag: pushes the pre-drag value once
//                                 (if anything actually changed).
//   reset(value)                  replaces the value and clears history.

import { useCallback, useMemo, useReducer } from "react"

export type Updater<T> = (prev: T) => T

const COALESCE_MS = 1000

interface HistoryState<T> {
  past: T[]
  present: T
  future: T[]
  /** Value before the drag currently in progress, if any */
  gestureBase: T | null
  lastKey: string | null
  lastTime: number
}

type Action<T> =
  | { type: "set"; update: Updater<T>; key: string | null; time: number }
  | { type: "preview"; update: Updater<T> }
  | { type: "commit" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; value: T }

function closeGesture<T>(s: HistoryState<T>, limit: number): HistoryState<T> {
  if (s.gestureBase === null) return s
  if (s.gestureBase === s.present) return { ...s, gestureBase: null }
  return {
    ...s,
    past: [...s.past, s.gestureBase].slice(-limit),
    future: [],
    gestureBase: null,
    lastKey: null,
  }
}

function makeReducer<T>(limit: number) {
  return function reducer(state: HistoryState<T>, action: Action<T>): HistoryState<T> {
    switch (action.type) {
      case "set": {
        const s = closeGesture(state, limit)
        const next = action.update(s.present)
        if (next === s.present) return s
        const coalesce = action.key !== null
          && action.key === s.lastKey
          && action.time - s.lastTime < COALESCE_MS
          && s.future.length === 0
          && s.past.length > 0
        if (coalesce) return { ...s, present: next, lastTime: action.time }
        return {
          ...s,
          past: [...s.past, s.present].slice(-limit),
          present: next,
          future: [],
          lastKey: action.key,
          lastTime: action.time,
        }
      }
      case "preview": {
        const next = action.update(state.present)
        if (next === state.present) return state
        return {
          ...state,
          present: next,
          gestureBase: state.gestureBase ?? state.present,
          lastKey: null,
        }
      }
      case "commit":
        return closeGesture(state, limit)
      case "undo": {
        const s = closeGesture(state, limit)
        if (s.past.length === 0) return s
        return {
          ...s,
          past: s.past.slice(0, -1),
          present: s.past[s.past.length - 1],
          future: [s.present, ...s.future],
          lastKey: null,
        }
      }
      case "redo": {
        const s = closeGesture(state, limit)
        if (s.future.length === 0) return s
        return {
          ...s,
          past: [...s.past, s.present].slice(-limit),
          present: s.future[0],
          future: s.future.slice(1),
          lastKey: null,
        }
      }
      case "reset":
        return { past: [], present: action.value, future: [], gestureBase: null, lastKey: null, lastTime: 0 }
    }
  }
}

export function useHistory<T>(initial: T, limit = 100) {
  const reducer = useMemo(() => makeReducer<T>(limit), [limit])
  const [state, dispatch] = useReducer(reducer, initial, (value: T): HistoryState<T> => ({
    past: [], present: value, future: [], gestureBase: null, lastKey: null, lastTime: 0,
  }))

  const set = useCallback((update: Updater<T>, opts?: { coalesceKey?: string }) =>
    dispatch({ type: "set", update, key: opts?.coalesceKey ?? null, time: Date.now() }), [])
  const preview = useCallback((update: Updater<T>) => dispatch({ type: "preview", update }), [])
  const commit  = useCallback(() => dispatch({ type: "commit" }), [])
  const undo    = useCallback(() => dispatch({ type: "undo" }), [])
  const redo    = useCallback(() => dispatch({ type: "redo" }), [])
  const reset   = useCallback((value: T) => dispatch({ type: "reset", value }), [])

  return {
    value: state.present,
    canUndo: state.past.length > 0 || (state.gestureBase !== null && state.gestureBase !== state.present),
    canRedo: state.future.length > 0,
    set, preview, commit, undo, redo, reset,
  }
}
