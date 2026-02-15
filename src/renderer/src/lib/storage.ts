const STORAGE_PREFIX = 'shepherds-power-tools::'

/**
 * Typed localStorage utility with namespace prefix to avoid collisions.
 */
export const storage = {
  get<T>(key: string, defaultValue: T): T {
    try {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`)
      if (raw === null) return defaultValue
      return JSON.parse(raw) as T
    } catch {
      return defaultValue
    }
  },

  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value))
    } catch (e) {
      console.error(`Failed to save to localStorage [${key}]:`, e)
    }
  },

  remove(key: string): void {
    localStorage.removeItem(`${STORAGE_PREFIX}${key}`)
  },

  keys(): string[] {
    const prefix = STORAGE_PREFIX
    const result: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) {
        result.push(key.slice(prefix.length))
      }
    }
    return result
  },

  clear(): void {
    const keysToRemove = this.keys()
    keysToRemove.forEach((key) => this.remove(key))
  }
}
