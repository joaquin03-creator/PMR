import React, { useEffect, useState } from 'react';
import { cn } from '../lib/utils';

export interface WeatherWidgetProps {
  city?: string;
  latitude?: number;
  longitude?: number;
  className?: string;
}

interface WeatherNow {
  temperature: number;
  weatherCode: number;
  isDay: boolean;
  high: number;
  low: number;
}

const REFRESH_MS = 15 * 60 * 1000;

/** WMO weather code (Open-Meteo) → icon + label. */
function describeWeather(code: number, isDay: boolean): { icon: string; label: string } {
  if (code === 0) return isDay ? { icon: '☀️', label: 'Clear' } : { icon: '🌙', label: 'Clear' };
  if (code === 1 || code === 2) return { icon: isDay ? '⛅' : '☁️', label: 'Partly Cloudy' };
  if (code === 3) return { icon: '☁️', label: 'Cloudy' };
  if (code === 45 || code === 48) return { icon: '🌫️', label: 'Fog' };
  if (code >= 51 && code <= 55) return { icon: '🌦️', label: 'Drizzle' };
  if (code === 56 || code === 57 || code === 66 || code === 67) return { icon: '🧊', label: 'Freezing Rain' };
  if (code >= 61 && code <= 65) return { icon: '🌧️', label: 'Rain' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: '❄️', label: 'Snow' };
  if (code >= 80 && code <= 82) return { icon: '🌦️', label: 'Showers' };
  if (code >= 95 && code <= 99) return { icon: '⛈️', label: 'Thunderstorm' };
  return { icon: '🌡️', label: 'Weather' };
}

/** iPhone-style weather card. Data from Open-Meteo (free, no API key). */
export function WeatherWidget({
  city = 'Cincinnati',
  latitude = 39.1906,
  longitude = -84.4153,
  className
}: WeatherWidgetProps) {
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let controller: AbortController | null = null;

    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
        '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min' +
        '&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=1';
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
        const data = await res.json();
        const next: WeatherNow = {
          temperature: data.current.temperature_2m,
          weatherCode: data.current.weather_code,
          isDay: data.current.is_day === 1,
          high: data.daily.temperature_2m_max[0],
          low: data.daily.temperature_2m_min[0]
        };
        if ([next.temperature, next.weatherCode, next.high, next.low].some(v => typeof v !== 'number')) {
          throw new Error('Open-Meteo: unexpected response');
        }
        setWeather(next);
        setFailed(false);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        console.warn('Weather unavailable:', err);
        // Keep showing the last good reading if there is one.
        setFailed(true);
      }
    };

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      clearInterval(timer);
      controller?.abort();
    };
  }, [latitude, longitude]);

  const sky = weather ? describeWeather(weather.weatherCode, weather.isDay) : null;

  // Click opens the National Weather Service forecast for the same spot, in a new tab so the app stays put.
  const forecastUrl = `https://forecast.weather.gov/MapClick.php?lat=${latitude}&lon=${longitude}`;

  return (
    <a
      href={forecastUrl}
      target="_blank"
      rel="noopener noreferrer"
      title="Open the National Weather Service forecast in a new tab"
      className={cn(
        'rounded-[22px] p-4 text-white shadow-lg flex flex-col min-h-[170px] w-[170px] transition-all hover:brightness-110 hover:shadow-xl',
        'bg-[linear-gradient(180deg,#3d7bd9_0%,#6aa6ec_100%)]',
        className
      )}
    >
      <span className="text-sm font-semibold truncate">{city}</span>
      {weather && sky ? (
        <>
          <div className="flex items-center justify-between mt-1">
            <span className="text-5xl font-extralight leading-none tracking-tight">{Math.round(weather.temperature)}°</span>
            <span className="text-3xl leading-none" aria-hidden="true">{sky.icon}</span>
          </div>
          <div className="mt-auto">
            <p className="text-xs font-semibold">{sky.label}</p>
            <p className="text-xs font-semibold">H:{Math.round(weather.high)}° L:{Math.round(weather.low)}°</p>
          </div>
        </>
      ) : (
        <p className="mt-auto text-xs font-semibold text-white/80">{failed ? 'Weather unavailable' : 'Loading…'}</p>
      )}
    </a>
  );
}
