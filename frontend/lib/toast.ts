import { toast } from "sonner";

export const notify = {
  error: (msg: string) => toast.error(msg, { duration: 5000 }),
  success: (msg: string) => toast.success(msg, { duration: 3000 }),
  info: (msg: string) => toast.info(msg, { duration: 3000 }),
  warning: (msg: string) => toast.warning(msg, { duration: 4000 }),
};
