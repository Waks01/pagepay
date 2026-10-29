/**
 * i18n translation system with static translation files.
 * Using react-i18next (industry standard, works offline).
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import yo from './locales/yo.json';
import ha from './locales/ha.json';
import ig from './locales/ig.json';
import pcm from './locales/pcm.json';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      yo: { translation: yo },
      ha: { translation: ha },
      ig: { translation: ig },
      pcm: { translation: pcm },
    },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;

