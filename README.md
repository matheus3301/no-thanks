# No Thanks Web

Versão web local, multiplayer, inspirada nas regras de No Thanks / Não, Obrigado.

## Rodar

```bash
npm install
npm start
```

Abra a URL exibida no terminal. Quem cria a mesa compartilha o QR Code da sala.

## Regras implementadas

- 3 a 7 jogadores.
- Cartas de 3 a 35; 9 cartas são removidas sem serem reveladas.
- 3-5 jogadores começam com 11 fichas; 6 com 9; 7 com 7.
- Na sua vez: pagar 1 ficha para passar ou pegar a carta atual com todas as fichas acumuladas nela.
- Quem não tem fichas precisa pegar a carta.
- Pontuação: soma das cartas, mas sequências consecutivas contam só a menor carta; depois subtrai as fichas. Menor pontuação vence.
