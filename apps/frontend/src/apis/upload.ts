import { apiEnum } from "@/enum/apiEnum"

export function uploadFile(data: FormData) {
  return fetch(apiEnum.UPLOAD_DOCUMENT, {
    method: "POST"
  })
}
/**
 * @TODO 未来多模态预留接口
*/
export function uploadImage(data: FormData) {
  return fetch(apiEnum.UPLOAD_IMAGE_URL, {
    method: "POST"
  })
}