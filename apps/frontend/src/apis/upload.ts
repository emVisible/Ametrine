import { apiEnum } from "@/enum/apiEnum"

export function uploadFile(data: FormData) {
  return fetch(apiEnum.UPLOAD_DOCUMENT, {
    method: "POST"
  })
}
export function uploadImage(data: FormData) {
  return fetch(apiEnum.UPLOAD_IMAGE_URL, {
    method: "POST"
  })
}