import { useTranslation } from "react-i18next";

import { AppConfigPanel } from "@/components/layout/app-config-modal";
import { StandardPageHeader } from "@/components/layout/standard-page-header";

export default function ConfigPage() {
    const { t } = useTranslation();

    return (
        <main className="h-full overflow-hidden bg-background">
            <div className="mx-auto flex h-full max-w-7xl flex-col px-4 sm:px-6 lg:px-8">
                <StandardPageHeader title={t("config.title")} description={t("config.description")} />
                <section className="min-h-0 min-w-0 flex-1 py-5 lg:py-8" aria-label={t("config.title")}>
                    <AppConfigPanel fillHeight />
                </section>
            </div>
        </main>
    );
}
