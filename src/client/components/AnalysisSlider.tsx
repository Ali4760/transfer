import React from 'react';

interface Props {
  value: number;
  onChange: (value: number) => void;
}

const AnalysisSlider: React.FC<Props> = ({ value, onChange }) => {
  const max = 20;

  // Calculate percentage for the gradient fill
  const percentage = (value / max) * 100;

  return (
    <div>
      <style dangerouslySetInnerHTML={{__html: `
        .custom-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #f0b90b;
          cursor: pointer;
          border: 4px solid #111520;
          box-shadow: 0 0 10px rgba(240,185,11,0.5);
        }
        .custom-range::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #f0b90b;
          cursor: pointer;
          border: 4px solid #111520;
          box-shadow: 0 0 10px rgba(240,185,11,0.5);
        }
      `}} />
      <input 
        type="range" 
        min="1" 
        max="20" 
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer custom-range" 
        style={{
          background: `linear-gradient(to right, #f0b90b 0%, #f0b90b ${percentage}%, #1e2636 ${percentage}%, #1e2636 100%)`
        }}
      />
      <div className="flex justify-between mt-1.5 relative">
        <span className="text-[#2a3444] text-[9px] font-mono">STANDARD</span>
        <span className="text-[#2a3444] text-[9px] font-mono absolute left-1/2 -translate-x-1/2">DEEP SCAN</span>
        <span className="text-[#2a3444] text-[9px] font-mono">FULL SCAN</span>
      </div>
    </div>
  );
};

export default AnalysisSlider;
