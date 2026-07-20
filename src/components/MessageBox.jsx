import { AlertCircle } from "lucide-react";

export default function MessageBox({ children, type = "info" }) {
  if (!children) return null;

  return (
    <div className={`message-box ${type}`}>
      <AlertCircle size={18} />
      <span>{children}</span>
    </div>
  );
}
