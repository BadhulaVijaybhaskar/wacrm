import * as React from 'react';
import { Input as InputPrimitive } from '@base-ui/react/input';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'border-input bg-card text-foreground file:text-foreground placeholder:text-muted-foreground hover:border-border/80 focus-visible:border-primary focus-visible:ring-primary/10 disabled:bg-muted aria-invalid:border-destructive aria-invalid:ring-destructive/10 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/20 h-10 w-full min-w-0 rounded-[12px] border px-3.5 py-2 text-base shadow-sm transition-[border-color,box-shadow] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-4 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-4 md:text-sm',
        className
      )}
      {...props}
    />
  );
}

export { Input };
