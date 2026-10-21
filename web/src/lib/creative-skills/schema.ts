import type { CreativeSkillRecipeV1 } from "./types.ts";

export function parseCreativeSkillRecipeV1(value: unknown): CreativeSkillRecipeV1 {
    const recipe = record(value, "recipe");
    onlyKeys(recipe, ["schemaVersion", "kind", "parameters", "steps", "finalOutputCount"], "recipe");
    if (recipe.schemaVersion !== 1) throw new Error("recipe.schemaVersion 必须为 1");
    if (recipe.kind !== "linear-image") throw new Error("recipe.kind 必须为 linear-image");
    const finalOutputCount = positiveInteger(recipe.finalOutputCount, "recipe.finalOutputCount");
    if (finalOutputCount > 4) throw new Error("recipe.finalOutputCount 必须为 1 到 4");
    const parameters = array(recipe.parameters, "recipe.parameters");
    if (parameters.length < 1 || parameters.length > 16) throw new Error("recipe.parameters 参数数量必须为 1 到 16");
    parameters.forEach((value, index) => inspectParameter(value, `recipe.parameters[${index}]`));
    const parameterKeys = parameters.map((value) => record(value, "recipe.parameters[]").key);
    if (new Set(parameterKeys).size !== parameterKeys.length) throw new Error("recipe.parameters 参数键重复");
    const userRequest = parameters.filter((value) => record(value, "recipe.parameters[]").key === "user-request");
    if (userRequest.length !== 1) throw new Error("recipe.parameters 必须且只能声明一个 user-request 参数");
    if (record(userRequest[0], "recipe.parameters[user-request]").type !== "text") throw new Error("user-request 参数类型必须为 text");
    const steps = array(recipe.steps, "recipe.steps");
    if (steps.length < 1 || steps.length > 3) throw new Error("recipe.steps 步骤数量必须为 1 到 3");
    const declaredParameters = new Set(parameterKeys);
    steps.forEach((value, index) => inspectStep(value, `recipe.steps[${index}]`, declaredParameters, index));
    return value as CreativeSkillRecipeV1;
}

function inspectParameter(value: unknown, path: string) {
    const parameter = record(value, path);
    const common = ["key", "label", "description", "required", "type"];
    const key = requiredString(parameter.key, `${path}.key`, 64);
    if (!/^[a-z][a-z0-9-]*$/.test(key)) throw new Error(`${path}.key 参数键格式无效`);
    requiredString(parameter.label, `${path}.label`, 80);
    optionalString(parameter.description, `${path}.description`, 500);
    if (typeof parameter.required !== "boolean") throw new Error(`${path}.required 参数必须是布尔值`);
    if (parameter.type === "text") {
        onlyKeys(parameter, [...common, "default", "maxLength"], path);
        const maxLength = parameter.maxLength === undefined ? 20_000 : positiveInteger(parameter.maxLength, `${path}.maxLength`);
        if (maxLength > 20_000) throw new Error(`${path}.maxLength 参数不能大于 20000`);
        const defaultValue = optionalString(parameter.default, `${path}.default`, maxLength);
        if (key !== "user-request" && parameter.required && defaultValue === undefined) throw new Error(`${path}.default 必填参数必须提供默认值`);
        if (parameter.required && defaultValue === "") throw new Error(`${path}.default 必填文本参数不能为空`);
    }
    else if (parameter.type === "enum") {
        onlyKeys(parameter, [...common, "options", "default"], path);
        const options = array(parameter.options, `${path}.options`);
        if (options.length < 1 || options.length > 32) throw new Error(`${path}.options 枚举参数必须有 1 到 32 个选项`);
        const values = options.map((option, index) => {
            const optionPath = `${path}.options[${index}]`;
            const item = record(option, optionPath);
            onlyKeys(item, ["value", "label"], optionPath);
            const optionValue = requiredString(item.value, `${optionPath}.value`, 80);
            requiredString(item.label, `${optionPath}.label`, 80);
            return optionValue;
        });
        if (new Set(values).size !== values.length) throw new Error(`${path}.options 枚举参数选项值重复`);
        const defaultValue = optionalString(parameter.default, `${path}.default`, 80);
        if (parameter.required && defaultValue === undefined) throw new Error(`${path}.default 必填参数必须提供默认值`);
        if (defaultValue !== undefined && !values.includes(defaultValue)) throw new Error(`${path}.default 不是枚举参数选项`);
        if (parameter.required && defaultValue === "") throw new Error(`${path}.default 必填枚举参数不能为空`);
    } else if (parameter.type === "integer") {
        onlyKeys(parameter, [...common, "min", "max", "step", "default"], path);
        const min = integer(parameter.min, `${path}.min`);
        const max = integer(parameter.max, `${path}.max`);
        const step = positiveInteger(parameter.step, `${path}.step`);
        if (min > max) throw new Error(`${path} 整数参数 min 不能大于 max`);
        if (parameter.required && parameter.default === undefined) throw new Error(`${path}.default 必填参数必须提供默认值`);
        if (parameter.default !== undefined) {
            const defaultValue = integer(parameter.default, `${path}.default`);
            if (defaultValue < min || defaultValue > max || (defaultValue - min) % step !== 0) throw new Error(`${path}.default 不符合整数参数范围或步长`);
        }
    } else if (parameter.type === "aspect-ratio") {
        onlyKeys(parameter, [...common, "options", "default"], path);
        const options = parameter.options === undefined ? undefined : array(parameter.options, `${path}.options`).map((option, index) => aspectRatio(option, `${path}.options[${index}]`));
        if (options && (options.length < 1 || options.length > 32 || new Set(options).size !== options.length)) throw new Error(`${path}.options 画幅参数选项无效`);
        const defaultValue = parameter.default === undefined ? undefined : aspectRatio(parameter.default, `${path}.default`);
        if (parameter.required && defaultValue === undefined) throw new Error(`${path}.default 必填参数必须提供默认值`);
        if (defaultValue !== undefined && options && !options.includes(defaultValue)) throw new Error(`${path}.default 不是画幅参数选项`);
    }
    else throw new Error(`${path}.type 不支持`);
}

function inspectStep(value: unknown, path: string, parameterKeys: Set<unknown>, stepIndex: number) {
    const step = record(value, path);
    onlyKeys(step, ["operation", "prompt", "references"], path);
    if (step.operation !== "image.generate" && step.operation !== "image.edit") throw new Error(`${path}.operation 不支持`);
    if (stepIndex > 0 && step.operation !== "image.edit") throw new Error(`${path} 后续步骤必须为图片编辑`);
    const prompt = array(step.prompt, `${path}.prompt`);
    if (prompt.length < 1 || prompt.length > 64) throw new Error(`${path}.prompt 必须有 1 到 64 个片段`);
    prompt.forEach((value, index) => {
        const segmentPath = `${path}.prompt[${index}]`;
        const segment = record(value, segmentPath);
        if (segment.type === "literal") {
            onlyKeys(segment, ["type", "text"], segmentPath);
            requiredString(segment.text, `${segmentPath}.text`, 20_000);
        }
        else if (segment.type === "parameter") {
            onlyKeys(segment, ["type", "key"], segmentPath);
            const key = requiredString(segment.key, `${segmentPath}.key`, 64);
            if (!parameterKeys.has(key)) throw new Error(`${segmentPath}.key 引用了未声明参数`);
        }
        else throw new Error(`${segmentPath}.type 不支持`);
    });
    if (step.references === undefined) return;
    const references = array(step.references, `${path}.references`);
    if (step.operation === "image.generate" && references.length) throw new Error(`${path} 生成步骤不能声明参考图`);
    if (references.length > 8) throw new Error(`${path}.references 不能超过 8 项`);
    const identities: string[] = [];
    references.forEach((value, index) => {
        const referencePath = `${path}.references[${index}]`;
        const reference = record(value, referencePath);
        if (reference.type === "asset") {
            onlyKeys(reference, ["type", "sha256"], referencePath);
            const hash = requiredString(reference.sha256, `${referencePath}.sha256`, 64);
            if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`${referencePath}.sha256 无效`);
            identities.push(`asset:${hash}`);
        }
        else if (reference.type === "input-target" || reference.type === "input-references") {
            onlyKeys(reference, ["type"], referencePath);
            identities.push(reference.type);
        }
        else throw new Error(`${referencePath}.type 不支持`);
    });
    if (new Set(identities).size !== identities.length) throw new Error(`${path}.references 包含重复参考图声明`);
}

function record(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} 必须是对象`);
    return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) throw new Error(`${path} 必须是数组`);
    return value;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string) {
    const unknownKey = Object.keys(value).find((key) => !allowed.includes(key));
    if (unknownKey) throw new Error(`${path} 包含不支持的字段：${unknownKey}`);
}

function requiredString(value: unknown, path: string, maxLength: number): string {
    if (typeof value !== "string" || !value.trim() || Array.from(value).length > maxLength) throw new Error(`${path} 参数必须是 1 到 ${maxLength} 个字符`);
    return value;
}

function optionalString(value: unknown, path: string, maxLength: number): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || Array.from(value).length > maxLength) throw new Error(`${path} 参数必须是不超过 ${maxLength} 个字符的文本`);
    return value;
}

function integer(value: unknown, path: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${path} 参数必须是安全整数`);
    return value;
}

function positiveInteger(value: unknown, path: string): number {
    const result = integer(value, path);
    if (result <= 0) throw new Error(`${path} 参数必须是正整数`);
    return result;
}

function aspectRatio(value: unknown, path: string): string {
    const ratio = requiredString(value, path, 16);
    if (ratio !== "auto" && !/^[1-9]\d{0,3}:[1-9]\d{0,3}$/.test(ratio)) throw new Error(`${path} 画幅参数格式无效`);
    return ratio;
}
