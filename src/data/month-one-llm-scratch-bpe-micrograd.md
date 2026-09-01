## Introduction: Why Build an LLM Toolkit from Scratch?

- Doing it to debug, evaluate, and improve LLMs in low-resource settings (like Hindi math reasoning), where off-the-shelf tools fail silently
- This toolkit will eventually help me measure why an LLM fails on Hindi math—and fix it.

### The “Why” Behind Autograd

- Automatic differentiation is just a smart way to apply the chain rule—tracking how a tiny change in a weight affects the final loss.
- Autograd is like a receipt that tracks every operation so you can return the exact change (gradient).
- Why build it on own?
  - If I can’t debug a 2-layer MLP, how can I trust a 40-layer transformer? (Errors with making the MLP handle both single and batch training took me time as visualizing MLP layers took me time to get comfortable)
  - How memory and compute scale with model depth
  - When my Hindi tokenizer produces weird embeddings, I need to trace gradients to see if the issue is in tokenization, embedding, or attention

#### Neurons, Linearity, and the Birth of Deep Learning

- A neuron is just output = w1*x1 + w2*x2 + ... + b. That’s a straight line. Stack 100 of them? Still a straight line. Add tanh or ReLU? Now you can bend reality.
- Token embeddings start as one-hot vectors (linear).
- Without non-linear activation, your model can’t learn that “2x + 3 = 7” and “2x + 3 = 7 को हल करें” represent the same math problem.
- Gradients flow through these non-linearities—if ReLU kills a gradient (dying ReLU), your Hindi tokens stop learning. When I saw grad = 1 - tanh(x)\*\*2, I finally got why gradients vanish.
- Backpropagation only works because we can compute d(tanh)/dx. That tiny derivative is why deep learning exists.

##### 0.05 learning rate

=== Single Input Training ===
Iteration 10, Loss: 0.012365817298845878
Iteration 20, Loss: 0.005033157138812617
Iteration 30, Loss: 0.0025885533462758196
Iteration 40, Loss: 0.0014944185813732535
Iteration 50, Loss: 0.0009243647657190611
Number of parameters: 41
Final output: [Value(data=0.8695966323293116) Grad=(-0.060806735341376816)]

=== Batch Training ===
Iteration 10, Loss: 0.15153267449969282
Iteration 20, Loss: 0.04910871803645721
Iteration 30, Loss: 0.028131768891827755
Iteration 40, Loss: 0.01942968216438895
Iteration 50, Loss: 0.014732909567027002
Number of parameters: 41
Final outputs: [Value(data=0.9517384049880856) Grad=(-0.09652319002382881), Value(data=-0.9510350324574308) Grad=(0.09792993508513836), Value(data=-0.931016872216683) Grad=(0.1379662555666341), Value(data=0.9275604524536586) Grad=(-0.14487909509268282)]

###### 0.2 learning rate

=== Single Input Training ===
Iteration 10, Loss: 0.0005953222363061605
Iteration 20, Loss: 0.0002620362580874617
Iteration 30, Loss: 9.89849572074661e-05
Iteration 40, Loss: 3.3246696557414585e-05
Iteration 50, Loss: 1.0319475404031417e-05
Number of parameters: 41
Final output: [Value(data=0.9032123940300081) Grad=(0.006424788060016118)]

=== Batch Training ===
Iteration 10, Loss: 0.00475026818123266
Iteration 20, Loss: 0.0024311601775359954
Iteration 30, Loss: 0.001651935820262
Iteration 40, Loss: 0.0012586163580185343
Iteration 50, Loss: 0.0010206547870789757
Number of parameters: 41
Final outputs: [Value(data=0.9950707316806381) Grad=(-0.009858536638723825), Value(data=-0.9743971557087453) Grad=(0.0512056885825094), Value(data=-0.9822430453696694) Grad=(0.035513909260661114), Value(data=0.9949460879144113) Grad=(-0.010107824171177393)]

##### 0.2 \* (0.9 \*\* trainingIter) learning rate

=== Single Input Training ===
Iteration 10, Loss: 0.006993390540865338
Iteration 20, Loss: 0.006929463640414042
Iteration 30, Loss: 0.006906610673097152
Iteration 40, Loss: 0.006898572253655141
Iteration 50, Loss: 0.006895760839231801
Number of parameters: 41
Final output: [Value(data=0.9830407179595155) Grad=(0.16608143591903102)]

=== Batch Training ===
Iteration 10, Loss: 0.011965705139735126
Iteration 20, Loss: 0.00886689895017375
Iteration 30, Loss: 0.008187327619450145
Iteration 40, Loss: 0.007979096557461686
Iteration 50, Loss: 0.00790949749837075
Number of parameters: 41
Final outputs: [Value(data=0.9787918625121909) Grad=(-0.042416274975618284), Value(data=-0.9731335739050986) Grad=(0.05373285218980284), Value(data=-0.9212796306393694) Grad=(0.1574407387212613), Value(data=0.9767403568539408) Grad=(-0.046519286292118434)]

##### Benchmarking pitfall

1. I was copying already trained weights earlier not remembering that weights have changed during the course of training. Big bug!

Had earlier code:

    # Create micrograd model (your code)
    micro_mlp = micrograd_mlp.MLP(num_inputs, hidden_layers)

    print("=== Training micrograd (custom loop) ===")
    losses_micro, _ = micro_mlp.train(x, y_true)

    # Create and initialize PyTorch model with SAME weights
    torch_mlp = pytorch_mlp.TorchMLP(num_inputs, hidden_layers)
    pytorch_mlp.copy_weights_from_micrograd(micro_mlp, torch_mlp)

Correct one is:

    # Create micrograd model (your code)
    micro_mlp = micrograd_mlp.MLP(num_inputs, hidden_layers)
    # Create and initialize PyTorch model with SAME weights
    torch_mlp = pytorch_mlp.TorchMLP(num_inputs, hidden_layers)
    pytorch_mlp.copy_weights_from_micrograd(micro_mlp, torch_mlp)

    print("=== Training micrograd (custom loop) ===")
    losses_micro, _ = micro_mlp.train(x, y_true)

2. I referred to Pytorch training code from an example in docs and that had seed. Which meant that however times I ran my initial weights were fixed. Took some time to figure out why initial weights are same across runs.

3. Forgot doing .zero_grad() before doing backward propagation. Something Andrej mentioned in his autograd video but I made the same mistake.

##### Benchmark with 0.05 learning rate

=== Training micrograd (custom loop) ===
Iteration 1, Loss: 2.1014358921528395
Iteration 11, Loss: 0.06819940973793552
Iteration 21, Loss: 0.03311511152808558
Iteration 31, Loss: 0.021569514719619945
Iteration 41, Loss: 0.01590883514052567

=== Training PyTorch ===
Iteration 1, Loss: 2.101436
Iteration 11, Loss: 0.068199
Iteration 21, Loss: 0.033115
Iteration 31, Loss: 0.021570
Iteration 41, Loss: 0.015909

Final Loss - micrograd: 0.012839
Final Loss - PyTorch: 0.012839
Difference: 7.03e-09
Max difference: 2.31e-07

### The "Why" behind BPE

- BPE is ideal because it adaptively learns subword units from data, preserving frequent meaningful tokens like "2x" or "है" while efficiently handling rare symbols (e.g., "∫") and complex scripts like Devanagari (by merging frequent character sequences such as "क्"+"ष" → "क्ष"), avoiding the vocabulary explosion of word-level tokenization and the semantic fragmentation of character- or byte-level approaches.
- You must train your own Hugging Face BPE (rather than using GPT-2, IndicBERT, or off-the-shelf tokenizers) because those were trained on generic text (English web or Wikipedia) and fail to preserve mathematical semantics (e.g., splitting "2x" into ["2","x"]) and underutilize Devanagari structure (e.g., not learning conjuncts), whereas a tokenizer trained on HindiMathQuest learns domain-specific patterns—like code-switching between Hindi questions and English math answers—and enables inspection, debugging, and control critical for your toolkit.
- Using UTF-8 bytes (vocab size = 256) would severely degrade performance: it inflates sequence lengths (each Devanagari character becomes 2–3 tokens, math symbols like "²" split into multiple bytes), destroys semantic units, forces the model to waste capacity reassembling characters instead of reasoning, and drastically reduces effective context length—making it unsuitable for symbolic reasoning tasks.
- The core challenge of your dataset lies in its multimodal code-switching nature: Hindi (script-based, no word spacing) + English (for technical answers) + mathematical notation (symbols, variables, operators) demands a tokenizer that respects all three modalities simultaneously—something only a custom BPE, trained on your data with math-aware pre-tokenization, can achieve while remaining inspectable and efficient.

#### Explaining challenges

1. I see output frequently has answers in full English and questions in Hindi. Mixed language. Pretty realistic
   Realism: Real Indian students do mix Hindi/English + math.
   Challenge: Forces your model to align semantics across languages.
   Novelty: Most LLMs fail at this — your toolkit can inspect how attention bridges languages.

2. Visualize merges: Plot frequent Devanagari pairs (e.g., "क्"+"ष" → "क्ष"): You’ll use this to debug why "2x" is kept intact but "αβ" is split — something tokenizers hides.
3. Ablation study: Show how vocab size affects math integrity: "BPE merged '2x' because it appeared 1,242 times in our dataset"
4. Failure cases: Document when BPE breaks (e.g., rare Sanskrit conjuncts): Devanagari conjuncts were learned automatically via Unicode character sequences

#### Test cases

2x + y = 5
x² + y² = r²
∫₀¹ x² dx
α + β = γ
है
क्षमा
ज्ञान
2x + y = 5 है
∫₀¹ x² dx का मान
Answer is 42 उत्तर है

∫₀¹ x² dx का मान ज्ञात करें
The value is 1/3
x का हल निकालें: x² - 4 = 0
Solutions are x = 2 and x = -2

#### Why BPE Starts with Bytes—Not Characters

How bytes avoid Unicode fragmentation
Why this is critical for Devanagari (e.g., “क्ष” = 3 bytes, but BPE can learn it as one unit)
How this prevents <unk> tokens in low-resource languages

#### Challenges

UTF-8 Byte Splitting Is Hurting Math Symbols and not preserving Math intergrity for math sequences which are not that frequent:
"∫" = bytes [226, 136, 171] got split into:
4366 = [226, 136] (incomplete)
171 = [171] (remainder)

Switch to Unicode Codepoints
Benefits:
"∫" = single codepoint 8747 → no splitting
"ह" = single codepoint 2361 → no splitting
Cleaner merges: 8747 (integral) can merge with 8320 (subscript 0)

2x + y = 5 है ∫₀¹ x² dx
in unicode becomes
'2', 'x + y', ' = 5', ' है ', '∫', '₀', '¹', ' ', 'x', '²', ' ', 'd', 'x'

#### Benchmarking

1. Vocabulary size: Training time, Compression Ratio
   500: 114.70s, 2.09x
   1000: 232.07s, 2.75x
   2000: 393.0s, 3.59x
   5000: 794.61s, 5.10x
   7500: 1082.95s, 5.91x
   10000: 1337.73s, 6.56x
   12500: 1625.81s, 7.13x
   15000: 1826.4s, 7.66x
   20000: 2295.99, 8.64x
   30000: 3012.90, 10.45x

2. Token preserving mathematical and indic integrity

IndicBert tokenizer was failing, fixed it with running "pip install --no-cache-dir transformers sentencepiece"

While GPT-2 remains superior for English web text, our custom BPE tokenizer achieves 51–80% fewer tokens on Hindi conjuncts and 28–60% fewer tokens on code-switching examples. This domain-specific optimization results in better overall efficiency (8.1 vs 8.4–9.4 average tokens) for the HindiMathQuest dataset — proving that specialized tokenization matters.
When your tokenizer understands that 'का हल निकालें' is a single semantic unit rather than 12 separate characters, your LLM can focus on reasoning instead of deciphering.
Efficiency isn’t just about speed—it’s about representation. If a language costs 2× more tokens, it gets 2× less attention in the same context window. That’s not a bug; it’s a bias baked into the tokenizer. Also more tokens → higher compute cost, worse attention modeling, amplification of training data bias

The Right Trade-off
Optimal engineering decision:

- Sacrifice some English efficiency (which you don't care about as much)
- Gain massive Hindi/math efficiency (which is your core use case)
- This is domain-specific optimization at its finest!
- Unlike GPT2 (https://cdn.openai.com/better-language-models/language_models_are_unsupervised_multitask_learners.pdf) which doesn't see a value in differentiating "dog." with "dog?", we need to rely on both semantics and symbols for our Math usecases

```
====================================================================================================
TOKENIZER PERFORMANCE MATRIX - HINDIMATHQUEST
====================================================================================================
Category             CustomBPE    HfBPE        GPT2         IndicBERT    SentencePiece
----------------------------------------------------------------------------------------------------
Hindi_Basic         1.8         2.8         7.2         3.6         1.2
Hindi_Conjuncts     2.2         5.5         11.0        4.5         2.3
Math_Basic          1.8         2.0         2.5         4.3         2.3
Math_Advanced       8.2         12.6        11.2        11.0        15.0
Code_Switching      9.2         14.8        23.0        12.8        12.8
Mixed_Symbols       7.8         8.6         8.2         9.2         14.0
Mixed_Hindi_English 16.3        22.9        33.9        17.5        17.8
English_Web         17.6        16.8        9.4         12.6        14.8
English_Contractions9.8         7.4         5.6         8.6         7.8
Punctuation_Heavy   15.6        14.0        9.6         11.8        15.8
Numbers_Currency    6.8         6.6         6.2         5.8         11.2
HindiMathQuest      29.0        60.8        137.0       36.5        30.0
OVERALL             10.5        14.6        22.1        11.5        12.1
```

<image 9-BPE-category-benchmark.png>
