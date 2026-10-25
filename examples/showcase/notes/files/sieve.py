"""The sieve of Eratosthenes: the primes below n, by crossing out multiples."""


def sieve(n: int) -> list[int]:
    is_prime = [True] * n
    is_prime[0] = is_prime[1] = False
    for p in range(2, int(n**0.5) + 1):
        if is_prime[p]:
            # every multiple of p from p² up is composite
            for multiple in range(p * p, n, p):
                is_prime[multiple] = False
    return [i for i, prime in enumerate(is_prime) if prime]


if __name__ == "__main__":
    print(sieve(100))
