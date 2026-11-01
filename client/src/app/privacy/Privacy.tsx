import React, { useEffect } from "react";
import Navbar from "../../components/Navbar";
import type { StoredUser } from "../../utils/cookie.util";

interface PrivacyPageProps {
    user: StoredUser | null;
    onNavigateHome: () => void;
    onSignOut: () => void;
    onRequestAuth: (reason?: string) => void;
}

export const Privacy: React.FC<PrivacyPageProps> = ({
    user,
    onNavigateHome,
    onSignOut,
    onRequestAuth,
}) => {
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    }, []);

    return (
        <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
            {/* Top Navigation Bar */}
            <Navbar
                user={user}
                onSignOut={onSignOut}
                onRequestAuth={onRequestAuth}
            />

            {/* Back Navigation Bar */}
            <div className="bg-white border-b border-slate-200 sticky top-16 z-30">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
                    <button
                        type="button"
                        onClick={onNavigateHome}
                        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-900 transition cursor-pointer"
                    >
                        <span>&larr;</span>
                        <span>Back to Question Papers</span>
                    </button>
                    <span className="text-xs text-slate-400 hidden sm:inline-block">
                        Updated 2026
                    </span>
                </div>
            </div>

            {/* Clean Document Container */}
            <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
                <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6 sm:p-12">
                    <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 pb-3 border-b-2 border-slate-100 mb-8">
                        Privacy Policy &amp; Terms of Use for cDocs
                    </h1>

                    <div className="space-y-6 text-sm text-slate-600 leading-relaxed">
                        <section>
                            <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">
                                1. Acceptance of Terms
                            </h2>
                            <p>
                                By accessing and using cDocs, you accept and agree to be bound by the terms and provisions of this agreement. This platform is provided strictly as a peer-to-peer educational resource.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">
                                2. Nature of Content &amp; Sourcing
                            </h2>
                            <p>
                                All question papers, notes, and study materials available on cDocs are strictly crowdsourced and independently uploaded by students across various colleges and universities. cDocs operates solely as a community repository and does not maintain official affiliations with any university, educational board, or examination authority.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">
                                3. Strict Prohibition of Future Exam Materials
                            </h2>
                            <p>
                                cDocs is a historical archive designed exclusively for past educational materials. <strong className="text-slate-900 font-semibold">Under no circumstances does cDocs host, distribute, or provide access to unreleased, leaked, or &quot;future&quot; exam question papers.</strong> Any user found attempting to upload or solicit upcoming exam papers will face immediate account termination and a permanent ban from the platform.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">
                                4. Accuracy and Reliance (Study at Your Own Risk)
                            </h2>
                            <p>
                                The materials provided on this platform are for reference purposes only. Because content is user-generated, cDocs does not guarantee the accuracy, completeness, or relevance of any document. Syllabi, exam formats, and grading criteria frequently change. You are solely responsible for verifying the relevance of any past paper against your current official university curriculum. cDocs is not liable for any academic performance outcomes, including failing grades resulting from reliance on outdated or incorrect materials found on this site.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">
                                5. User-Generated Content &amp; Copyright
                            </h2>
                            <p>
                                By uploading documents to cDocs, you confirm that you have the right to share the material. Users must not upload copyrighted textbooks, published research papers behind paywalls, or premium commercial study guides. If you are an educational institution or copyright holder and believe your proprietary material has been uploaded without authorization, you may submit a takedown request to our support team for immediate removal.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">
                                6. Limitation of Liability
                            </h2>
                            <p>
                                In no event shall cDocs, its developers, or its community moderators be liable for any direct, indirect, incidental, consequential, or punitive damages arising out of your access to, or use of, the platform. The service is provided on an &quot;as is&quot; and &quot;as available&quot; basis without any warranties of any kind.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">
                                7. Privacy and Data Collection
                            </h2>
                            <p>
                                cDocs respects your privacy. We collect only the minimum data required to maintain the platform&apos;s functionality, such as basic authentication details (email, username) and session cookies to keep you logged in. We do not track your specific document downloads to sell to third-party advertisers or external educational organizations. Any uploaded documents will be publicly credited to your chosen username unless uploaded anonymously.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">
                                8. Modifications to the Service
                            </h2>
                            <p>
                                cDocs reserves the right to modify, suspend, or discontinue any part of the platform, including deleting specific documents or wiping inactive accounts, at any time without prior notice.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">
                                9. Future Monetization &amp; Platform Sustainability
                            </h2>
                            <p>
                                Currently, access to cDocs is provided completely free of charge. However, to cover ongoing server maintenance costs and to provide token rewards to the dedicated students who spend time collecting and uploading these resources, we reserve the right to introduce a nominal fee (ranging from ₹1 to ₹10 per document) in the future. Any such pricing changes will be transparently communicated to all users well in advance of implementation.
                            </p>
                        </section>

                        <footer className="mt-12 pt-6 border-t border-slate-200 text-xs text-slate-500">
                            <p>
                                If you have any questions regarding these policies or need to submit a content removal request, please contact the cDocs administrative team.
                            </p>
                            <p className="mt-1 font-medium text-slate-600">
                                &copy; 2026 cDocs. All rights reserved.
                            </p>
                        </footer>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default Privacy;
