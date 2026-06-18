import { listToolDTOs } from '../tools/registry'

export default defineEventHandler(() => {
  return {
    items: listToolDTOs(),
  }
})
