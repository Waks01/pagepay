import { useState, useRef, useEffect } from 'react';
import { ReactNode } from 'react';

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  children: ReactNode;
  content: string;
  position?: TooltipPosition;
  delay?: number;
  className?: string;
}

export function Tooltip({
  children,
  content,
  position = 'top',
  delay = 300,
  className = '',
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition>(position);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  let timeoutId: NodeJS.Timeout;

  const showTooltip = () => {
    timeoutId = setTimeout(() => {
      setIsVisible(true);
      // Calculate smart positioning
      if (containerRef.current && tooltipRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const tooltipRect = tooltipRef.current.getBoundingClientRect();
        
        // Check if tooltip would go off-screen and adjust position
        if (position === 'top' && containerRect.top < tooltipRect.height + 10) {
          setTooltipPosition('bottom');
        } else if (position === 'bottom' && window.innerHeight - containerRect.bottom < tooltipRect.height + 10) {
          setTooltipPosition('top');
        } else if (position === 'left' && containerRect.left < tooltipRect.width + 10) {
          setTooltipPosition('right');
        } else if (position === 'right' && window.innerWidth - containerRect.right < tooltipRect.width + 10) {
          setTooltipPosition('left');
        } else {
          setTooltipPosition(position);
        }
      }
    }, delay);
  };

  const hideTooltip = () => {
    clearTimeout(timeoutId);
    setIsVisible(false);
  };

  useEffect(() => {
    return () => clearTimeout(timeoutId);
  }, []);

  const getPositionClasses = () => {
    switch (tooltipPosition) {
      case 'top':
        return 'bottom-full mb-2 left-1/2 -translate-x-1/2';
      case 'bottom':
        return 'top-full mt-2 left-1/2 -translate-x-1/2';
      case 'left':
        return 'right-full mr-2 top-1/2 -translate-y-1/2';
      case 'right':
        return 'left-full ml-2 top-1/2 -translate-y-1/2';
      default:
        return 'bottom-full mb-2 left-1/2 -translate-x-1/2';
    }
  };

  const getArrowClasses = () => {
    const baseClasses = 'absolute w-2 h-2 bg-bg-card border border-border';
    switch (tooltipPosition) {
      case 'top':
        return `${baseClasses} -bottom-1 left-1/2 -translate-x-1/2 rotate-45`;
      case 'bottom':
        return `${baseClasses} -top-1 left-1/2 -translate-x-1/2 rotate-45`;
      case 'left':
        return `${baseClasses} -right-1 top-1/2 -translate-y-1/2 rotate-45`;
      case 'right':
        return `${baseClasses} -left-1 top-1/2 -translate-y-1/2 rotate-45`;
      default:
        return `${baseClasses} -bottom-1 left-1/2 -translate-x-1/2 rotate-45`;
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative inline-block ${className}`}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}
      
      {isVisible && (
        <div
          ref={tooltipRef}
          className={`absolute z-50 whitespace-nowrap rounded-md bg-bg-card px-2 py-1 text-xs text-text-main border border-border shadow-lg pointer-events-none transition-opacity duration-200 ${getPositionClasses()}`}
        >
          {content}
          <div className={getArrowClasses()} />
        </div>
      )}
    </div>
  );
}
