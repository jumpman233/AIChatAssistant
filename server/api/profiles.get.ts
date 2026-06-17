import { listProfileDTOs } from '../profiles'

export default defineEventHandler(() => {
  return listProfileDTOs()
})
