import type { CreativeSkill, CreativeSkillDefinition } from "@/types/creative-skill";

export const EDITORIAL_POSTER_SKILL_ID = "fourj.editorial-poster-v1";
export const EDITORIAL_POSTER_VERSION_ID = "sha256:6f667985b603cb6e0efcf9691cf7e7ab4840ff6908258209beb0d79dd2413639";

const editorialPosterDefinition: CreativeSkillDefinition = {
    schemaVersion: 1,
    kind: "linear-image",
    parameters: [
        { key: "user-request", label: "创作要求", type: "text", required: true, maxLength: 1200 },
        { key: "headline", label: "主标题", type: "text", required: false, maxLength: 80 },
        { key: "aspect-ratio", label: "画面比例", type: "aspect-ratio", required: false, options: ["auto", "1:1", "4:5", "3:4", "16:9", "9:16"], default: "auto" },
    ],
    steps: [
        {
            operation: "image.edit",
            references: [{ type: "input-target" }, { type: "input-references" }],
            prompt: [
                { type: "literal", text: "把原图转化为具有独立杂志编辑感的艺术海报，并遵循以下稳定视觉语法。第一，完整保留原图主体的身份、面部、姿态、服装或产品结构、真实材质、核心光影与可辨识细节，不随意换人、换物、重绘背景或改变叙事。第二，依据主体位置、视线方向、景深和原图留白自适应排版，不套固定坐标模板；允许裁切边缘，但不能遮住面部、眼睛或关键识别部位。第三，整体采用低饱和暖调电影色彩，压低刺眼高光与数码锐度，保留自然暗部层次；叠加克制的纸纤维、旧印刷、网点和细腻胶片颗粒，让画面有真实纸本触感而不是脏污滤镜。第四，建立清晰的编辑字体层级：用一组大号、高对比衬线标题形成视觉骨架，可与主体边缘穿插、局部遮挡或低透明叠印；辅以少量小号打字机体或杂志字幕。若未提供明确文案，不要生成大段随机文字。第五，只在有助于平衡构图时加入一到两处星形、细线、手写笔触或页码式点缀，装饰必须服从主体。主标题内容（空值则不强行添加文字）：" },
                { type: "parameter", key: "headline" },
                { type: "literal", text: "。具体创作要求：" },
                { type: "parameter", key: "user-request" },
                { type: "literal", text: "。禁止改变主体身份与关键结构，禁止过度磨皮、塑料感、霓虹高饱和、廉价复古滤镜、统一居中模板、密集装饰、无意义乱码、伪造品牌标志和水印；最终结果应像为这张原图单独完成的编辑设计，而不是给所有图片套用同一张版式。" },
            ],
        },
    ],
    finalOutputCount: 1,
};

export const BUILTIN_CREATIVE_SKILLS: CreativeSkill[] = [
    {
        skillId: EDITORIAL_POSTER_SKILL_ID,
        revision: 1,
        lifecycle: "published",
        ownership: "builtin",
        trust: "builtin-verified",
        source: "builtin",
        name: "编辑海报",
        description: "保留原图主体与真实材质，转化为低饱和暖调、纸张印刷质感和自适应字体编排的编辑海报。",
        enabled: true,
        favorite: false,
        activeRevision: EDITORIAL_POSTER_VERSION_ID,
        versions: [
            {
                versionId: EDITORIAL_POSTER_VERSION_ID,
                definitionHash: EDITORIAL_POSTER_VERSION_ID,
                definition: editorialPosterDefinition,
                validation: { status: "passed", definitionHash: EDITORIAL_POSTER_VERSION_ID, issues: [] },
                testRun: { status: "passed", definitionHash: EDITORIAL_POSTER_VERSION_ID, runId: "builtin-verification", issues: [] },
                compatibility: { status: "compatible", issues: [] },
                health: { status: "healthy", issues: [] },
                publishedAt: "2026-08-21T00:00:00.000Z",
            },
        ],
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z",
    },
];
