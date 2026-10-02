import { useEffect, useMemo, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import { useFeedback } from '../context/FeedbackContext';
import {
  inferFeedbackType,
  isTransientFeedback,
} from '../services/feedbackService';

function getText(children) {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children).trim();
  }

  return '';
}

export default function MessageBox({ children, type = 'info', title = '' }) {
  const feedback = useFeedback();
  const lastShown = useRef('');
  const text = useMemo(() => getText(children), [children]);
  const transient = text ? isTransientFeedback(text) : false;
  const resolvedType = inferFeedbackType(text, type);

  useEffect(() => {
    if (!text) {
      lastShown.current = '';
      return;
    }

    if (transient || lastShown.current === text) return;

    lastShown.current = text;
    feedback.notify({
      type: resolvedType,
      title: title || undefined,
      message: text,
    });
  }, [feedback, resolvedType, text, title, transient]);

  if (!children) return null;

  if (!text || transient) {
    return (
      <div className={`message-box ${resolvedType}`}>
        <AlertCircle size={18} />
        <span>{children}</span>
      </div>
    );
  }

  return null;
}
