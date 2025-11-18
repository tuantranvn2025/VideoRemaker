import React from 'react';
import { XCircleIcon } from './icons';

export interface Notification {
  id: number;
  message: string;
  type: 'error' | 'success' | 'info';
}

interface NotificationToastProps {
  notification: Notification;
  onDismiss: (id: number) => void;
}

const typeClasses = {
  error: {
    bg: 'bg-red-600',
    icon: <XCircleIcon className="w-6 h-6 text-white" />,
  },
  success: {
    bg: 'bg-green-600',
    icon: null, // Can add a success icon later if needed
  },
  info: {
    bg: 'bg-blue-600',
    icon: null, // Can add an info icon later if needed
  }
};

const NotificationToast: React.FC<NotificationToastProps> = ({ notification, onDismiss }) => {
  const handleDismiss = () => {
    onDismiss(notification.id);
  };

  const classes = typeClasses[notification.type];

  return (
    <div
      className={`w-full max-w-sm rounded-lg shadow-lg pointer-events-auto ring-1 ring-black ring-opacity-5 overflow-hidden animate-fade-in-right ${classes.bg}`}
    >
      <div className="p-4">
        <div className="flex items-start">
          {classes.icon && <div className="flex-shrink-0">{classes.icon}</div>}
          <div className="ml-3 w-0 flex-1 pt-0.5">
            <p className="text-sm font-medium text-white">{notification.message}</p>
          </div>
          <div className="ml-4 flex-shrink-0 flex">
            <button
              onClick={handleDismiss}
              className="inline-flex rounded-md text-gray-100 hover:text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              <span className="sr-only">Close</span>
              <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};


interface NotificationContainerProps {
  notifications: Notification[];
  onDismiss: (id: number) => void;
}

const NotificationContainer: React.FC<NotificationContainerProps> = ({ notifications, onDismiss }) => {
  return (
    <div aria-live="assertive" className="fixed inset-0 flex items-end px-4 py-6 pointer-events-none sm:p-6 sm:items-start z-[100]">
      <div className="w-full flex flex-col items-center space-y-4 sm:items-end">
        {notifications.map(n => (
          <NotificationToast key={n.id} notification={n} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
};

export default NotificationContainer;
