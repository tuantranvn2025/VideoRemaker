
import React from 'react';

interface LoaderProps {
  text?: string;
  progress?: number;
}

const Loader: React.FC<LoaderProps> = ({ text = "Generating...", progress }) => {
  // If progress is provided (and is a number), show the progress bar UI
  if (typeof progress === 'number') {
    const clampedProgress = Math.max(0, Math.min(100, progress));
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-sm text-gray-300 mb-2">{text}</p>
        <div className="w-full max-w-xs bg-gray-700 rounded-full h-2.5">
          <div
            className="bg-indigo-500 h-2.5 rounded-full transition-all duration-300 ease-linear"
            style={{ width: `${clampedProgress}%` }}
          ></div>
        </div>
        <p className="text-xs text-gray-400 mt-2">{Math.round(clampedProgress)}%</p>
      </div>
    );
  }

  // Original spinner loader
  return (
    <div className="flex flex-col items-center justify-center space-y-2 text-sm text-gray-400">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400"></div>
      <p>{text}</p>
    </div>
  );
};

export default Loader;