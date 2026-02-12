type ToastOptions = {
  title?: string;
  description?: string;
  variant?: string;
};

export const toast = (_opts: ToastOptions) => {
  return;
};

export const useToast = () => {
  return { toast };
};
