import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "@/i18n/locales/en-US";
import zhCN from "@/i18n/locales/zh-CN";

export type AppLocale = "zh-CN" | "en-US";

const LOCALE_STORAGE_KEY = "infinite-canvas:locale";

i18n.use(initReactI18next).init({
    resources: {
        "zh-CN": { translation: zhCN },
        "en-US": { translation: enUS },
    },
    lng: (localStorage.getItem(LOCALE_STORAGE_KEY) as AppLocale) || "zh-CN",
    fallbackLng: "zh-CN",
    supportedLngs: ["zh-CN", "en-US"],
    initAsync: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

document.documentElement.lang = i18n.resolvedLanguage || "zh-CN";
i18n.on("languageChanged", (locale) => {
    document.documentElement.lang = locale;
});

i18n.addResourceBundle("zh-CN", "translation", {
    settingsPanels: { video: { returnLastFrame: "返回尾帧", promptOptimizer: "提示词优化", fastPretreatment: "快速预处理" } },
    seedance: { errors: { duration: "{{label}} 时长需要在 2-{{max}} 秒之间", totalDuration: "Seedance 参考视频总时长不能超过 {{max}} 秒" } },
    apiErrors: {
        apimartVideoModelUnsupported: "当前 APIMart 视频模型暂不支持普通视频生成，请选择 Seedance、Hailuo 或 H3 模型",
        apimartWorkflowModelUnsupported: "当前 APIMart 模型属于 H3 专用工作流，请从视频结果中使用对应工作流",
        apimartVideoTaskCreateFailed: "APIMart 视频任务创建失败",
        apimartVideoTaskQueryFailed: "APIMart 视频任务查询失败",
        apimartVideoFailed: "APIMart 视频生成失败",
        apimartImageUploadFailed: "参考图上传 APIMart 失败",
        apimartVideoReferenceUrlRequired: "APIMart 参考视频需要公网可访问的 URL",
        apimartAudioReferenceUrlRequired: "APIMart 参考音频需要公网可访问的 URL",
        apimartVideoReferenceUnsupported: "当前 APIMart 视频模型不支持参考视频",
        apimartAudioReferenceUnsupported: "当前 APIMart 视频模型不支持参考音频",
        apimartHailuoFastRequiresImage: "MiniMax Hailuo Fast 必须提供首帧图片",
        apimartTooManyImages: "当前模型最多支持 {{limit}} 张参考图片，请删除多余图片后再生成",
        apimartTooManyVideos: "当前模型最多支持 {{limit}} 个参考视频，请删除多余视频后再生成",
        apimartTooManyAudios: "当前模型最多支持 {{limit}} 个参考音频，请删除多余音频后再生成",
        apimartImageTooLarge: "当前模型的单张参考图片不能超过 {{limit}}MB",
        apimartVideoTooLarge: "当前模型的单个参考视频不能超过 {{limit}}MB",
        apimartAudioTooLarge: "当前模型的单个参考音频不能超过 {{limit}}MB",
        apimartFrameRatio: "当前首帧或首尾帧任务的比例必须使用“自适应”，请取消固定比例后重试",
        apimartTaskTypeConstraint: "APIMart 判断当前任务属于编辑、延长或首尾帧模式，所选比例或时长不符合该模式限制，请按工作台提示调整",
        apimartDurationRange: "当前模型的视频时长只支持 {{range}} 秒，请调整后重试",
        apimartResolutionDuration: "当前分辨率不支持所选时长；1080p 只能使用该模型的最短时长",
        apimartResolutionUnsupported: "当前模型不支持所选分辨率，请从工作台提供的分辨率中重新选择",
        apimartReferenceLimit: "参考素材数量超过当前模型上限，请删除多余素材后重试",
        apimartVideoProbeFailed: "APIMart 无法读取参考视频，请确认文件未损坏且链接可以正常访问",
        apimartContentRejected: "本次内容或参考素材未通过 APIMart 安全审核，请调整提示词或更换素材",
        apimartPromptRejected: "提示词未通过内容审核，请删减可能涉及敏感人物、暴力、色情或受限品牌的描述后重试",
        apimartReferenceRejected: "参考素材未通过内容审核，请逐张移除可疑参考图，确认是哪一张触发后再更换素材",
        apimartOutputRejected: "模型生成结果未通过内容审核；输入已提交成功，请调整提示词强度或更换模型后重试",
        apimartBalanceInsufficient: "APIMart 账户余额或可用额度不足，请充值或检查套餐后重试",
        apimartReferenceUnavailable: "APIMart 无法读取参考素材，请重新上传或更换可访问的素材",
        apimartUnknown: "APIMart 返回了尚未识别的限制错误。技术信息：{{detail}}",
        seedanceVideoDuration: "Seedance 参考视频单个时长需要在 2-{{max}} 秒之间",
        seedanceVideoTotalDuration: "Seedance 参考视频总时长不能超过 {{max}} 秒",
        seedanceAudioDuration: "Seedance 参考音频单个时长需要在 2-{{max}} 秒之间",
        seedanceAudioTotalDuration: "Seedance 参考音频总时长不能超过 {{max}} 秒",
    },
}, true, true);
i18n.addResourceBundle("en-US", "translation", {
    settingsPanels: { video: { returnLastFrame: "Return last frame", promptOptimizer: "Prompt optimizer", fastPretreatment: "Fast pretreatment" } },
    seedance: { errors: { duration: "{{label}} must be 2–{{max}} seconds", totalDuration: "Seedance reference videos cannot exceed {{max}} seconds in total" } },
    apiErrors: {
        apimartVideoModelUnsupported: "This APIMart video model is not supported for regular generation. Choose a Seedance, Hailuo, or H3 model.",
        apimartWorkflowModelUnsupported: "This APIMart model is an H3 workflow. Use the corresponding workflow from a video result.",
        apimartVideoTaskCreateFailed: "Failed to create APIMart video task",
        apimartVideoTaskQueryFailed: "Failed to query APIMart video task",
        apimartVideoFailed: "APIMart video generation failed",
        apimartImageUploadFailed: "Failed to upload the reference image to APIMart",
        apimartVideoReferenceUrlRequired: "APIMart reference videos need a publicly accessible URL",
        apimartAudioReferenceUrlRequired: "APIMart reference audio needs a publicly accessible URL",
        apimartVideoReferenceUnsupported: "This APIMart video model does not support reference videos",
        apimartAudioReferenceUnsupported: "This APIMart video model does not support reference audio",
        apimartHailuoFastRequiresImage: "MiniMax Hailuo Fast requires a first-frame image",
        apimartTooManyImages: "This model accepts at most {{limit}} reference images. Remove the extras and try again.",
        apimartTooManyVideos: "This model accepts at most {{limit}} reference videos. Remove the extras and try again.",
        apimartTooManyAudios: "This model accepts at most {{limit}} reference audio files. Remove the extras and try again.",
        apimartImageTooLarge: "Each reference image must be no larger than {{limit}}MB for this model.",
        apimartVideoTooLarge: "Each reference video must be no larger than {{limit}}MB for this model.",
        apimartAudioTooLarge: "Each reference audio file must be no larger than {{limit}}MB for this model.",
        apimartFrameRatio: "First-frame and first/last-frame tasks require Adaptive aspect ratio. Remove the fixed ratio and try again.",
        apimartTaskTypeConstraint: "APIMart classified this as an edit, extension, or frame-controlled task, but the selected ratio or duration is incompatible. Follow the workbench guidance.",
        apimartDurationRange: "This model only supports video durations in the {{range}} second range.",
        apimartResolutionDuration: "The selected duration is unavailable at this resolution. 1080p requires the shortest duration for this model.",
        apimartResolutionUnsupported: "This model does not support the selected resolution. Choose one of the resolutions shown in the workbench.",
        apimartReferenceLimit: "The number of reference assets exceeds this model's limit. Remove the extras and try again.",
        apimartVideoProbeFailed: "APIMart could not read the reference video. Check that the file is valid and its URL is reachable.",
        apimartContentRejected: "The prompt or reference asset did not pass APIMart safety review. Adjust the prompt or replace the asset.",
        apimartPromptRejected: "The prompt did not pass content review. Remove potentially restricted people, violence, sexual content, or brand terms and try again.",
        apimartReferenceRejected: "A reference asset did not pass content review. Remove references one at a time to identify and replace the blocked item.",
        apimartOutputRejected: "The generated output did not pass content review. Adjust the prompt strength or switch models and try again.",
        apimartBalanceInsufficient: "The APIMart balance or available quota is insufficient. Check the plan or add funds and try again.",
        apimartReferenceUnavailable: "APIMart could not read the reference asset. Upload it again or use a reachable asset.",
        apimartUnknown: "APIMart returned an unrecognized constraint error. Technical details: {{detail}}",
        seedanceVideoDuration: "Each Seedance reference video must be 2–{{max}} seconds",
        seedanceVideoTotalDuration: "Seedance reference videos cannot exceed {{max}} seconds in total",
        seedanceAudioDuration: "Each Seedance reference audio file must be 2–{{max}} seconds",
        seedanceAudioTotalDuration: "Seedance reference audio cannot exceed {{max}} seconds in total",
    },
}, true, true);

export function changeAppLocale(locale: AppLocale) {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    return i18n.changeLanguage(locale);
}

export default i18n;
