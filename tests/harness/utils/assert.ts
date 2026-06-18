export const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) {
    throw new Error(message)
  }
}

export const assertEqual = <T>(actual: T, expected: T, message: string) => {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}`)
  }
}

export const assertArray = (value: unknown, message: string): asserts value is unknown[] => {
  assert(Array.isArray(value), message)
}
