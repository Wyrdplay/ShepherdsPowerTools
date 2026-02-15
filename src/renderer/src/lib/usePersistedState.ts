import { useState, useEffect, useCallback } from 'react'
import { storage } from './storage'

/**
 * A React hook that persists state to localStorage.
 * Works like useState but automatically syncs to localStorage on changes.
 *
 * @param key - The storage key (will be prefixed with 'shepherds-power-tools::')
 * @param defaultValue - The default value if nothing is stored
 * @returns [value, setValue] tuple just like useState
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    return storage.get<T>(key, defaultValue)
  })

  useEffect(() => {
    storage.set(key, state)
  }, [key, state])

  const setPersistedState = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState(value)
    },
    []
  )

  return [state, setPersistedState]
}
