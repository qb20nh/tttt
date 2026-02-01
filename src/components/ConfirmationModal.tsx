


interface ConfirmationModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    confirmText?: string;
    cancelText?: string;
}

export const ConfirmationModal = ({
    isOpen,
    title,
    message,
    onConfirm,
    onCancel,
    confirmText = "Confirm",
    cancelText = "Cancel"
}: ConfirmationModalProps) => {
    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="max-w-md w-full bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 transform scale-100 transition-all">
                <h2 className="text-2xl font-bold text-white mb-4">{title}</h2>
                <p className="text-slate-300 mb-8 leading-relaxed">
                    {message}
                </p>

                <div className="flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-lg transition-colors cursor-pointer"
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};
