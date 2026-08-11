import { useState } from 'react';
import { StyleSheet, Pressable, Text, View, ScrollView, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type SymbolCategory = 'math' | 'greek' | 'physics' | 'code' | 'scientific' | 'arrows';

const SYMBOL_CATEGORIES: Record<SymbolCategory, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  math: { label: 'Math', icon: 'calculator-outline' },
  greek: { label: 'Greek', icon: 'language-outline' },
  physics: { label: 'Physics', icon: 'flash-outline' },
  code: { label: 'Code', icon: 'code-slash-outline' },
  scientific: { label: 'Sci', icon: 'flask-outline' },
  arrows: { label: 'Arrows', icon: 'arrow-forward-outline' },
};

const SYMBOLS: Record<SymbolCategory, { symbol: string; label: string }[]> = {
  math: [
    { symbol: '+', label: '+' }, { symbol: '−', label: '−' }, { symbol: '×', label: '×' },
    { symbol: '÷', label: '÷' }, { symbol: '=', label: '=' }, { symbol: '≠', label: '≠' },
    { symbol: '≈', label: '≈' }, { symbol: '√', label: '√' }, { symbol: '∛', label: '∛' },
    { symbol: '∫', label: '∫' }, { symbol: '∑', label: '∑' }, { symbol: '∏', label: '∏' },
    { symbol: '∂', label: '∂' }, { symbol: 'Δ', label: 'Δ' }, { symbol: '∇', label: '∇' },
    { symbol: '%', label: '%' }, { symbol: '‰', label: '‰' }, { symbol: '∞', label: '∞' },
    { symbol: 'π', label: 'π' }, { symbol: '±', label: '±' }, { symbol: '∓', label: '∓' },
    { symbol: '|', label: '|' }, { symbol: '∥', label: '∥' }, { symbol: '⊥', label: '⊥' },
    { symbol: '∠', label: '∠' }, { symbol: '°', label: '°' }, { symbol: '′', label: '′' },
    { symbol: '″', label: '″' }, { symbol: '∈', label: '∈' }, { symbol: '∉', label: '∉' },
    { symbol: '⊂', label: '⊂' }, { symbol: '⊃', label: '⊃' }, { symbol: '⊆', label: '⊆' },
    { symbol: '∪', label: '∪' }, { symbol: '∩', label: '∩' }, { symbol: '∅', label: '∅' },
    { symbol: '∀', label: '∀' }, { symbol: '∃', label: '∃' }, { symbol: '¬', label: '¬' },
    { symbol: '∧', label: '∧' }, { symbol: '∨', label: '∨' }, { symbol: '⇒', label: '⇒' },
    { symbol: '⇔', label: '⇔' }, { symbol: '→', label: '→' }, { symbol: '←', label: '←' },
  ],
  greek: [
    { symbol: 'α', label: 'alpha' }, { symbol: 'β', label: 'beta' }, { symbol: 'γ', label: 'gamma' },
    { symbol: 'δ', label: 'delta' }, { symbol: 'ε', label: 'epsilon' }, { symbol: 'ζ', label: 'zeta' },
    { symbol: 'η', label: 'eta' }, { symbol: 'θ', label: 'theta' }, { symbol: 'ι', label: 'iota' },
    { symbol: 'κ', label: 'kappa' }, { symbol: 'λ', label: 'lambda' }, { symbol: 'μ', label: 'mu' },
    { symbol: 'ν', label: 'nu' }, { symbol: 'ξ', label: 'xi' }, { symbol: 'π', label: 'pi' },
    { symbol: 'ρ', label: 'rho' }, { symbol: 'σ', label: 'sigma' }, { symbol: 'τ', label: 'tau' },
    { symbol: 'υ', label: 'upsilon' }, { symbol: 'φ', label: 'phi' }, { symbol: 'χ', label: 'chi' },
    { symbol: 'ψ', label: 'psi' }, { symbol: 'ω', label: 'omega' },
    { symbol: 'Α', label: 'Alpha' }, { symbol: 'Β', label: 'Beta' }, { symbol: 'Γ', label: 'Gamma' },
    { symbol: 'Δ', label: 'Delta' }, { symbol: 'Θ', label: 'Theta' }, { symbol: 'Λ', label: 'Lambda' },
    { symbol: 'Π', label: 'Pi' }, { symbol: 'Σ', label: 'Sigma' }, { symbol: 'Φ', label: 'Phi' },
    { symbol: 'Ψ', label: 'Psi' }, { symbol: 'Ω', label: 'Omega' },
  ],
  physics: [
    { symbol: 'ℏ', label: 'h-bar' }, { symbol: 'c', label: 'speed of light' },
    { symbol: 'G', label: 'gravitational constant' }, { symbol: 'k', label: 'Boltzmann' },
    { symbol: 'g', label: 'gravity' }, { symbol: 'F', label: 'force' },
    { symbol: 'm', label: 'mass' }, { symbol: 'a', label: 'acceleration' },
    { symbol: 'v', label: 'velocity' }, { symbol: 't', label: 'time' },
    { symbol: 'd', label: 'distance' }, { symbol: 'T', label: 'period' },
    { symbol: 'f', label: 'frequency' }, { symbol: 'λ', label: 'wavelength' },
    { symbol: 'ν', label: 'nu' }, { symbol: 'E', label: 'energy' },
    { symbol: 'W', label: 'work' }, { symbol: 'P', label: 'power' },
    { symbol: 'p', label: 'momentum' }, { symbol: 'q', label: 'charge' },
    { symbol: 'V', label: 'voltage' }, { symbol: 'I', label: 'current' },
    { symbol: 'R', label: 'resistance' }, { symbol: 'B', label: 'magnetic field' },
    { symbol: 'H', label: 'magnetic field strength' }, { symbol: 'M', label: 'magnetization' },
    { symbol: 'Φ', label: 'magnetic flux' }, { symbol: 'ε', label: 'emf' },
    { symbol: 'L', label: 'inductance' }, { symbol: 'C', label: 'capacitance' },
    { symbol: 'T', label: 'temperature' }, { symbol: 'P', label: 'pressure' },
    { symbol: 'V', label: 'volume' }, { symbol: 'n', label: 'moles' },
    { symbol: 'R', label: 'gas constant' }, { symbol: 'z', label: 'impedance' },
  ],
  code: [
    { symbol: '{', label: '{' }, { symbol: '}', label: '}' },
    { symbol: '[', label: '[' }, { symbol: ']', label: ']' },
    { symbol: '(', label: '(' }, { symbol: ')', label: ')' },
    { symbol: '<', label: '<' }, { symbol: '>', label: '>' },
    { symbol: ';', label: ';' }, { symbol: ':', label: ':' },
    { symbol: '=', label: '=' }, { symbol: '==', label: '==' },
    { symbol: '!=', label: '!=' }, { symbol: '===', label: '===' },
    { symbol: '!==', label: '!==' }, { symbol: '=>', label: '=>' },
    { symbol: '->', label: '->' }, { symbol: '::', label: '::' },
    { symbol: '...', label: '...' }, { symbol: '&', label: '&' },
    { symbol: '|', label: '|' }, { symbol: '^', label: '^' },
    { symbol: '~', label: '~' }, { symbol: '<<', label: '<<' },
    { symbol: '>>', label: '>>' }, { symbol: '+=', label: '+=' },
    { symbol: '-=', label: '-=' }, { symbol: '*=', label: '*=' },
    { symbol: '/=', label: '/=' }, { symbol: '%=', label: '%=' },
    { symbol: '&&', label: '&&' }, { symbol: '||', label: '||' },
    { symbol: '!', label: '!' }, { symbol: '?', label: '?' },
    { symbol: '`', label: '`' }, { symbol: '#', label: '#' },
    { symbol: '@', label: '@' }, { symbol: '$', label: '$' },
    { symbol: '\\', label: '\\' }, { symbol: '_', label: '_' },
  ],
  scientific: [
    { symbol: '×10ⁿ', label: 'x10^n' }, { symbol: 'eⁿ', label: 'e^n' },
    { symbol: '¹', label: '1 superscript' }, { symbol: '²', label: '2 superscript' },
    { symbol: '³', label: '3 superscript' }, { symbol: '⁴', label: '4 superscript' },
    { symbol: '⁵', label: '5 superscript' }, { symbol: '⁶', label: '6 superscript' },
    { symbol: '⁷', label: '7 superscript' }, { symbol: '⁸', label: '8 superscript' },
    { symbol: '⁹', label: '9 superscript' }, { symbol: '⁰', label: '0 superscript' },
    { symbol: '₀', label: '0 subscript' }, { symbol: '₁', label: '1 subscript' },
    { symbol: '₂', label: '2 subscript' }, { symbol: '₃', label: '3 subscript' },
    { symbol: '₄', label: '4 subscript' }, { symbol: '₅', label: '5 subscript' },
    { symbol: '₆', label: '6 subscript' }, { symbol: '₇', label: '7 subscript' },
    { symbol: '₈', label: '8 subscript' }, { symbol: '₉', label: '9 subscript' },
    { symbol: '°C', label: 'celsius' }, { symbol: '°F', label: 'fahrenheit' },
    { symbol: 'Å', label: 'angstrom' }, { symbol: 'μ', label: 'micro' },
    { symbol: 'Ω', label: 'ohm' }, { symbol: 'Å', label: 'angstrom alt' },
    { symbol: '℧', label: 'mho' }, { symbol: 'ℵ', label: 'aleph' },
  ],
  arrows: [
    { symbol: '→', label: 'right' }, { symbol: '←', label: 'left' },
    { symbol: '↑', label: 'up' }, { symbol: '↓', label: 'down' },
    { symbol: '↔', label: 'left-right' }, { symbol: '↕', label: 'up-down' },
    { symbol: '⇒', label: 'implies' }, { symbol: '⇐', label: 'implied by' },
    { symbol: '⇔', label: 'iff' }, { symbol: '↦', label: 'maps to' },
    { symbol: '↗', label: 'up-right' }, { symbol: '↘', label: 'down-right' },
    { symbol: '↙', label: 'down-left' }, { symbol: '↖', label: 'up-left' },
    { symbol: '⟶', label: 'long right' }, { symbol: '⟹', label: 'long implies' },
    { symbol: '⎯', label: 'overline' }, { symbol: '⎷', label: 'sqrt' },
  ],
};

type SymbolEditorProps = {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  height?: number;
};

export function SymbolEditor({ value, onChange, placeholder = 'Write your answer...', multiline = true, height = 120 }: SymbolEditorProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const [activeCategory, setActiveCategory] = useState<SymbolCategory>('math');
  const symbols = SYMBOLS[activeCategory];

  const insertSymbol = (symbol: string) => {
    onChange(value + symbol);
  };

  const categories = Object.entries(SYMBOL_CATEGORIES) as [SymbolCategory, { label: string; icon: keyof typeof Ionicons.glyphMap }][];

  return (
    <View style={[styles.container, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
      <View style={styles.symbolGrid}>
        {categories.map(([key, cat]) => {
          const isActive = activeCategory === key;
          return (
            <Pressable
              key={key}
              onPress={() => setActiveCategory(key)}
              style={[
                styles.categoryBtn,
                {
                  backgroundColor: isActive ? tokens.mint : tokens.paper,
                  borderColor: isActive ? tokens.mint : tokens.border,
                },
              ]}
            >
              <Ionicons name={cat.icon} size={16} color={isActive ? tokens.mintText : tokens.inkMuted} />
              <Text style={[styles.categoryLabel, { color: isActive ? tokens.mintText : tokens.inkMuted }]}>
                {cat.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.symbolScroll}>
        <View style={styles.symbolRow}>
          {symbols.map((item) => (
            <Pressable
              key={item.symbol}
              onPress={() => insertSymbol(item.symbol)}
              style={({ pressed }) => [
                styles.symbolBtn,
                {
                  backgroundColor: pressed ? tokens.mint + '30' : tokens.paper,
                  borderColor: tokens.border,
                },
              ]}
            >
              <Text style={[styles.symbolText, { color: tokens.ink }]}>{item.symbol}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.editorWrapper, { borderColor: tokens.border }]}>
        <TextInput
          style={[styles.editor, { color: tokens.ink, backgroundColor: tokens.paper }]}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={tokens.inkMuted}
          multiline={multiline}
          textAlignVertical="top"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    gap: 10,
  },
  symbolGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  categoryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  categoryLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  symbolScroll: {
    paddingHorizontal: 12,
  },
  symbolRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingBottom: 8,
  },
  symbolBtn: {
    minWidth: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 6,
  },
  symbolText: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  editorWrapper: {
    marginHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  editor: {
    padding: 12,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: 'monospace',
    minHeight: 120,
  },
});
